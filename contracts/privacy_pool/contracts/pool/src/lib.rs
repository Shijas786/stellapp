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
}

mod vk;
use vk::{VerificationKey, get_vk};

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
}

#[contract]
pub struct PrivacyPool;

#[contractimpl]
impl PrivacyPool {
    /// Initialize the privacy pool with the USDC token address and the Verifying Key
    pub fn initialize(env: Env, admin: Address, token: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Admin updates the current Merkle root (handled by the off-chain bot after processing a deposit)
    pub fn update_root(env: Env, new_root: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::CurrentRoot, &new_root);
    }

    /// Get current Merkle root
    pub fn get_root(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::CurrentRoot).unwrap_or(BytesN::from_array(&env, &[0; 32]))
    }

    /// User deposits USDC into the pool (adds commitment)
    pub fn deposit(env: Env, from: Address, amount: i128, _commitment: BytesN<32>) {
        from.require_auth();
        
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        
        token_client.transfer(&from, &env.current_contract_address(), &amount);
        
        // In a fully trustless on-chain setup, the contract would update the Merkle tree here.
        // For the hackathon demo, the off-chain bot updates the tree and calls update_root.
        // We emit an event so the bot knows a deposit happened.
        env.events().publish((Symbol::new(&env, "deposit"),), _commitment);
    }

    /// User withdraws USDC privately using a ZK proof
    pub fn withdraw(
        env: Env,
        proof: Proof,
        root_bytes: BytesN<32>, 
        nullifier_hash_bytes: BytesN<32>, 
        recipient_square_bytes: BytesN<32>,
        to: Address,
        amount: i128,
    ) -> Result<(), PoolError> {
        // 1. Check if nullifier has been used
        if env.storage().persistent().has(&DataKey::Nullifier(nullifier_hash_bytes.clone())) {
            return Err(PoolError::NullifierAlreadyUsed);
        }

        // 2. Load Verification Key from hardcoded vk.rs
        let vk: VerificationKey = get_vk(&env);

        // 3. Prepare public signals for the SNARK
        let root_fr = Fr::from_bytes(root_bytes);
        let nullifier_hash_fr = Fr::from_bytes(nullifier_hash_bytes.clone());
        let recipient_square_fr = Fr::from_bytes(recipient_square_bytes);
        
        let pub_signals = vec![&env, root_fr, nullifier_hash_fr, recipient_square_fr];

        // 4. Verify Proof
        let is_valid = Self::verify_groth16(&env, vk, proof, pub_signals)?;
        if !is_valid {
            return Err(PoolError::InvalidProof);
        }

        // 5. Mark nullifier as spent
        env.storage().persistent().set(&DataKey::Nullifier(nullifier_hash_bytes), &true);

        // 6. Transfer funds
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
