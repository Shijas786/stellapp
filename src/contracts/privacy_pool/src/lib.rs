#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Bytes, BytesN, Env,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Commitment(BytesN<32>),
    Nullifier(BytesN<32>),
}

#[contract]
pub struct PrivacyPool;

#[contractimpl]
impl PrivacyPool {
    /// Initializes the pool with the target token (e.g. USDC contract address)
    pub fn initialize(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Deposits USDC into the pool by submitting a commitment hash
    pub fn deposit(env: Env, depositor: Address, commitment: BytesN<32>, amount: i128) {
        depositor.require_auth();

        // 1. Get token client
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);

        // 2. Transfer USDC to the contract
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        // 3. Store the commitment hash
        let commitment_key = DataKey::Commitment(commitment);
        if env.storage().persistent().has(&commitment_key) {
            panic!("Commitment already exists");
        }
        env.storage().persistent().set(&commitment_key, &amount);
    }

    /// Withdraws USDC from the pool privately by providing the original secret and nullifier
    pub fn withdraw(
        env: Env,
        recipient: Address,
        secret: BytesN<32>,
        nullifier: BytesN<32>,
        amount: i128,
    ) {
        // 1. Reconstruct the commitment: hash(secret || nullifier || amount)
        let mut preimage = Bytes::new(&env);
        preimage.append(&secret.clone().into());
        preimage.append(&nullifier.clone().into());
        
        // Convert amount to 16 bytes big-endian
        let amount_u128 = amount as u128;
        let mut amount_arr = [0u8; 16];
        let bytes_u128 = amount_u128.to_be_bytes();
        for i in 0..16 {
            amount_arr[i] = bytes_u128[i];
        }
        let mut amount_bytes = Bytes::new(&env);
        amount_bytes.extend_from_slice(&amount_arr);

        preimage.append(&amount_bytes);

        let commitment = env.crypto().keccak256(&preimage);
        let commitment_bytes32: BytesN<32> = commitment.try_into().unwrap();

        // 2. Verify commitment exists and matches the amount
        let commitment_key = DataKey::Commitment(commitment_bytes32.clone());
        if !env.storage().persistent().has(&commitment_key) {
            panic!("Invalid proof: Commitment not found");
        }
        let stored_amount: i128 = env.storage().persistent().get(&commitment_key).unwrap();
        if stored_amount != amount {
            panic!("Invalid proof: Amount mismatch");
        }

        // 3. Verify nullifier hasn't been spent
        let nullifier_hash = env.crypto().keccak256(&nullifier.into());
        let nullifier_hash_bytes32: BytesN<32> = nullifier_hash.try_into().unwrap();
        let nullifier_key = DataKey::Nullifier(nullifier_hash_bytes32.clone());
        if env.storage().persistent().has(&nullifier_key) {
            panic!("Nullifier already spent (double spend)");
        }

        // 4. Mark nullifier as spent and deactivate commitment
        env.storage().persistent().set(&nullifier_key, &true);
        env.storage().persistent().remove(&commitment_key);

        // 5. Transfer USDC from contract to recipient
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);
    }
}
