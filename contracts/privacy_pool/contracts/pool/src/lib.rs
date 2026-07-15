#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, Address, BytesN, Env, Symbol, Vec, token,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    MalformedVerifyingKey = 1,
    InvalidProof = 2,
    NullifierAlreadyUsed = 3,
    InvalidDeposit = 4,
    RootMismatch = 5,
    RecipientMismatch = 6,
    NotInitialized = 7,
    AmountMismatch = 8,
    NonCanonicalFieldElement = 9,
}

mod vk;
use vk::{VerificationKey, get_vk};

#[cfg(test)]
mod test;

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: BytesN<96>,
    pub b: BytesN<192>,
    pub c: BytesN<96>,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    VK,
    CurrentRoot,
    Nullifier(BytesN<32>),
    Denomination,
}

const BLS12_381_R: [u8; 32] = [
    0x73, 0xed, 0xa7, 0x53, 0x29, 0x9d, 0x7d, 0x48,
    0x33, 0x39, 0xd8, 0x08, 0x09, 0xa1, 0xd8, 0x05,
    0x53, 0xbd, 0xa4, 0x02, 0xff, 0xfe, 0x5b, 0xfe,
    0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01
];

fn is_canonical(bytes: &BytesN<32>) -> bool {
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    for i in 0..32 {
        if arr[i] < BLS12_381_R[i] {
            return true;
        }
        if arr[i] > BLS12_381_R[i] {
            return false;
        }
    }
    false
}

fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(10000, 500000);
}

#[contract]
pub struct PrivacyPool;

#[contractimpl]
impl PrivacyPool {
    /// Initialize the privacy pool with the USDC token address and the Verifying Key
    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        // Prevent frontrunning by verifying the admin authorized the initialization
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        extend_instance_ttl(&env);
    }

    /// Admin updates the current Merkle root (handled by the off-chain bot after processing a deposit)
    pub fn update_root(env: Env, new_root: BytesN<32>) {
        if !is_canonical(&new_root) {
            panic!("Non-canonical root");
        }
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::CurrentRoot, &new_root);
        extend_instance_ttl(&env);
    }

    /// Get current Merkle root
    pub fn get_root(env: Env) -> BytesN<32> {
        extend_instance_ttl(&env);
        env.storage().instance().get(&DataKey::CurrentRoot).unwrap_or(BytesN::from_array(&env, &[0; 32]))
    }

    /// User deposits USDC into the pool (adds commitment)
    pub fn deposit(env: Env, from: Address, amount: i128, commitment: BytesN<32>) {
        from.require_auth();
        
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        // Fixed Denomination logic: Lock pool to the amount of the first deposit (Fix 1.2 part 1)
        let denomination_key = DataKey::Denomination;
        let denomination: i128 = if env.storage().instance().has(&denomination_key) {
            env.storage().instance().get(&denomination_key).unwrap()
        } else {
            env.storage().instance().set(&denomination_key, &amount);
            amount
        };

        if amount != denomination {
            panic!("Amount must match pool denomination");
        }
        
        token_client.transfer(&from, &env.current_contract_address(), &amount);
        
        // In a fully trustless on-chain setup, the contract would update the Merkle tree here.
        // For the hackathon demo, the off-chain bot updates the tree and calls update_root.
        // We emit an event so the bot knows a deposit happened.
        env.events().publish((Symbol::new(&env, "deposit"),), commitment);
    }

    /// User withdraws USDC privately using a ZK proof
    pub fn withdraw(
        env: Env,
        proof: Proof,
        root_bytes: BytesN<32>, 
        nullifier_hash_bytes: BytesN<32>, 
        recipient_hi: BytesN<32>,
        recipient_lo: BytesN<32>,
        to: Address,
        amount: i128,
    ) -> Result<(), PoolError> {
        extend_instance_ttl(&env);

        // 0. Verification that the pool has been initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(PoolError::NotInitialized);
        }

        // Validate that all public signals represent canonical BLS12-381 field elements (strictly less than R)
        if !is_canonical(&root_bytes) 
            || !is_canonical(&nullifier_hash_bytes) 
            || !is_canonical(&recipient_hi) 
            || !is_canonical(&recipient_lo) 
        {
            return Err(PoolError::NonCanonicalFieldElement);
        }

        // 1. Check caller-supplied Merkle root against on-chain CurrentRoot (Fix 1.1)
        let current_root: BytesN<32> = env.storage().instance().get(&DataKey::CurrentRoot)
            .ok_or(PoolError::RootMismatch)?;
        if root_bytes != current_root {
            return Err(PoolError::RootMismatch);
        }

        // 2. Enforce pool denomination constraint (Fix 1.2 part 2)
        let denomination: i128 = env.storage().instance().get(&DataKey::Denomination)
            .ok_or(PoolError::NotInitialized)?;
        if amount != denomination {
            return Err(PoolError::AmountMismatch);
        }

        // 3. Check if nullifier has been used
        let nullifier_key = DataKey::Nullifier(nullifier_hash_bytes.clone());
        if env.storage().persistent().has(&nullifier_key) {
            return Err(PoolError::NullifierAlreadyUsed);
        }

        // 4. Verify caller-supplied recipient public signals match the 'to' address payload
        use soroban_sdk::xdr::ToXdr;
        let to_xdr = to.clone().to_xdr(&env);
        let mut to_payload = [0u8; 32];
        if to_xdr.len() == 44 {
            to_xdr.slice(12..44).copy_into_slice(&mut to_payload);
        } else if to_xdr.len() == 40 {
            to_xdr.slice(8..40).copy_into_slice(&mut to_payload);
        } else {
            return Err(PoolError::RecipientMismatch);
        }

        let mut expected_hi = [0u8; 32];
        let mut expected_lo = [0u8; 32];
        for i in 0..16 {
            expected_hi[i + 16] = to_payload[i];
            expected_lo[i + 16] = to_payload[i + 16];
        }

        let expected_hi_n = BytesN::from_array(&env, &expected_hi);
        let expected_lo_n = BytesN::from_array(&env, &expected_lo);

        if recipient_hi != expected_hi_n || recipient_lo != expected_lo_n {
            return Err(PoolError::RecipientMismatch);
        }

        // 5. Prevent proof hijacking: Require authorization from the recipient (Fix 1.3 part 1)
        to.require_auth();

        // 6. Load Verification Key from hardcoded vk.rs
        let vk: VerificationKey = get_vk(&env);

        // 7. Prepare public signals for the SNARK
        let root_fr = Fr::from_bytes(root_bytes);
        let nullifier_hash_fr = Fr::from_bytes(nullifier_hash_bytes.clone());
        let recipient_hi_fr = Fr::from_bytes(recipient_hi);
        let recipient_lo_fr = Fr::from_bytes(recipient_lo);
        
        let pub_signals = vec![&env, root_fr, nullifier_hash_fr, recipient_hi_fr, recipient_lo_fr];

        // 8. Verify Proof
        let is_valid = Self::verify_groth16(&env, vk, proof, pub_signals)?;
        if !is_valid {
            return Err(PoolError::InvalidProof);
        }

        // 9. Mark nullifier as spent and extend its TTL to prevent expiration replay
        env.storage().persistent().set(&nullifier_key, &true);
        env.storage().persistent().extend_ttl(&nullifier_key, 10000, 500000);

        // 10. Transfer funds
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        Ok(())
    }

    fn verify_groth16(
        env: &Env,
        vk: VerificationKey,
        proof: Proof,
        pub_signals: Vec<Fr>,
    ) -> Result<bool, PoolError> {
        let bls = env.crypto().bls12_381();

        let proof_a = G1Affine::from_bytes(proof.a);
        let proof_b = G2Affine::from_bytes(proof.b);
        let proof_c = G1Affine::from_bytes(proof.c);

        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(PoolError::MalformedVerifyingKey);
        }
        let mut vk_x = vk.ic.get(0).unwrap();
        for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let prod = bls.g1_mul(&v, &s);
            vk_x = bls.g1_add(&vk_x, &prod);
        }

        let neg_a = -proof_a;
        let vp1 = vec![env, neg_a, vk.alpha, vk_x, proof_c];
        let vp2 = vec![env, proof_b, vk.beta, vk.gamma, vk.delta];

        Ok(bls.pairing_check(vp1, vp2))
    }
}
