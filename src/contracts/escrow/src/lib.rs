#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initializes the Escrow contract with depositor, recipient, arbiter, token asset, and target amount.
    pub fn initialize(
        env: Env,
        depositor: Address,
        recipient: Address,
        arbiter: Address,
        token: Address,
        amount: i128,
    ) {
        let inst = env.storage().instance();
        
        let init_sym = Symbol::new(&env, "initialized");
        if inst.has(&init_sym) {
            panic!("Contract already initialized");
        }
        
        inst.set(&init_sym, &true);
        inst.set(&Symbol::new(&env, "depositor"), &depositor);
        inst.set(&Symbol::new(&env, "recipient"), &recipient);
        inst.set(&Symbol::new(&env, "arbiter"), &arbiter);
        inst.set(&Symbol::new(&env, "token"), &token);
        inst.set(&Symbol::new(&env, "amount"), &amount);
        inst.set(&Symbol::new(&env, "status"), &0u32); // 0 = Active, 1 = Released, 2 = Refunded
    }

    /// Releases the funds to the recipient (must be authorized by the arbiter)
    pub fn release(env: Env) {
        let inst = env.storage().instance();
        
        let status: u32 = inst.get(&Symbol::new(&env, "status")).unwrap_or(0);
        if status != 0 {
            panic!("Escrow is not active");
        }
        
        let arbiter: Address = inst.get(&Symbol::new(&env, "arbiter")).unwrap();
        arbiter.require_auth();

        let token: Address = inst.get(&Symbol::new(&env, "token")).unwrap();
        let recipient: Address = inst.get(&Symbol::new(&env, "recipient")).unwrap();
        let amount: i128 = inst.get(&Symbol::new(&env, "amount")).unwrap();

        // Perform token transfer from contract address to recipient
        let client = soroban_sdk::token::Client::new(&env, &token);
        client.transfer(&env.current_contract_address(), &recipient, &amount);

        inst.set(&Symbol::new(&env, "status"), &1u32);
    }

    /// Refunds the funds back to the depositor (must be authorized by the arbiter)
    pub fn refund(env: Env) {
        let inst = env.storage().instance();
        
        let status: u32 = inst.get(&Symbol::new(&env, "status")).unwrap_or(0);
        if status != 0 {
            panic!("Escrow is not active");
        }

        let arbiter: Address = inst.get(&Symbol::new(&env, "arbiter")).unwrap();
        arbiter.require_auth();

        let token: Address = inst.get(&Symbol::new(&env, "token")).unwrap();
        let depositor: Address = inst.get(&Symbol::new(&env, "depositor")).unwrap();
        let amount: i128 = inst.get(&Symbol::new(&env, "amount")).unwrap();

        // Perform token transfer from contract address to depositor
        let client = soroban_sdk::token::Client::new(&env, &token);
        client.transfer(&env.current_contract_address(), &depositor, &amount);

        inst.set(&Symbol::new(&env, "status"), &2u32);
    }

    /// Fetches the details of the escrow vault.
    pub fn get_details(env: Env) -> (Address, Address, Address, Address, i128, u32) {
        let inst = env.storage().instance();
        
        let depositor: Address = inst.get(&Symbol::new(&env, "depositor")).unwrap();
        let recipient: Address = inst.get(&Symbol::new(&env, "recipient")).unwrap();
        let arbiter: Address = inst.get(&Symbol::new(&env, "arbiter")).unwrap();
        let token: Address = inst.get(&Symbol::new(&env, "token")).unwrap();
        let amount: i128 = inst.get(&Symbol::new(&env, "amount")).unwrap();
        let status: u32 = inst.get(&Symbol::new(&env, "status")).unwrap_or(0);
        
        (depositor, recipient, arbiter, token, amount, status)
    }
}
