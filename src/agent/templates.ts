export const NFT_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String};

#[contract]
pub struct NFTContract;

#[contractimpl]
impl NFTContract {
    pub fn initialize(env: Env, owner: Address, name: String, symbol: String, total_supply: u64) {
        env.storage().persistent().set(&Symbol::new(&env, "owner"), &owner);
        env.storage().persistent().set(&Symbol::new(&env, "name"), &name);
        env.storage().persistent().set(&Symbol::new(&env, "symbol"), &symbol);
        env.storage().persistent().set(&Symbol::new(&env, "total_supply"), &total_supply);
        env.storage().persistent().set(&Symbol::new(&env, "minted"), &0u64);
    }

    pub fn mint(env: Env, to: Address, token_id: u64) -> bool {
        let owner: Address = env.storage().persistent().get(&Symbol::new(&env, "owner")).unwrap();
        owner.require_auth();
        
        let mut key_bytes = [0u8; 32];
        key_bytes[0..8].copy_from_slice(&token_id.to_be_bytes());
        let key = Symbol::new(&env, "token"); // Simplified for template
        env.storage().persistent().set(&key, &to);
        
        let minted: u64 = env.storage().persistent().get(&Symbol::new(&env, "minted")).unwrap_or(0);
        env.storage().persistent().set(&Symbol::new(&env, "minted"), &(minted + 1));
        
        true
    }

    pub fn burn(env: Env, token_id: u64) -> bool {
        let key = Symbol::new(&env, "token");
        env.storage().persistent().set(&key, &Address::from_contract_id(&env));
        true
    }

    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) -> bool {
        from.require_auth();
        let key = Symbol::new(&env, "token");
        let owner: Address = env.storage().persistent().get(&key).unwrap();
        if owner != from { panic!("Not owner"); }
        env.storage().persistent().set(&key, &to);
        true
    }

    pub fn owner_of(env: Env, token_id: u64) -> Address {
        let key = Symbol::new(&env, "token");
        env.storage().persistent().get(&key).unwrap_or_else(|| Address::from_contract_id(&env))
    }

    pub fn total_minted(env: Env) -> u64 {
        env.storage().persistent().get(&Symbol::new(&env, "minted")).unwrap_or(0)
    }
}
`;

export const ESCROW_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String, vec};

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn initialize(env: Env, buyer: Address, seller: Address, arbiter: Address, amount: i128, timeout_seconds: u64) {
        env.storage().persistent().set(&Symbol::new(&env, "buyer"), &buyer);
        env.storage().persistent().set(&Symbol::new(&env, "seller"), &seller);
        env.storage().persistent().set(&Symbol::new(&env, "arbiter"), &arbiter);
        env.storage().persistent().set(&Symbol::new(&env, "amount"), &amount);
        env.storage().persistent().set(&Symbol::new(&env, "status"), &Symbol::new(&env, "pending"));
        env.storage().persistent().set(&Symbol::new(&env, "deadline"), &(env.ledger().timestamp() + timeout_seconds as u64));
    }

    pub fn deposit(env: Env, buyer: Address, amount: i128) {
        buyer.require_auth();
        let stored_amount: i128 = env.storage().persistent().get(&Symbol::new(&env, "amount")).unwrap_or(0);
        if amount != stored_amount { panic!("Amount mismatch"); }
        env.storage().persistent().set(&Symbol::new(&env, "status"), &Symbol::new(&env, "funded"));
    }

    pub fn confirm_delivery(env: Env, seller: Address) {
        seller.require_auth();
        let status: Symbol = env.storage().persistent().get(&Symbol::new(&env, "status")).unwrap_or_else(|| Symbol::new(&env, "pending"));
        if status != Symbol::new(&env, "funded") { panic!("Not funded"); }
        env.storage().persistent().set(&Symbol::new(&env, "status"), &Symbol::new(&env, "completed"));
    }

    pub fn release(env: Env, arbiter: Address) -> bool {
        arbiter.require_auth();
        let status: Symbol = env.storage().persistent().get(&Symbol::new(&env, "status")).unwrap_or_else(|| Symbol::new(&env, "pending"));
        if status != Symbol::new(&env, "completed") { panic!("Work not confirmed"); }
        env.storage().persistent().set(&Symbol::new(&env, "status"), &Symbol::new(&env, "released"));
        true
    }

    pub fn refund(env: Env) -> bool {
        let deadline: u64 = env.storage().persistent().get(&Symbol::new(&env, "deadline")).unwrap_or(0);
        if env.ledger().timestamp() < deadline { panic!("Deadline not reached"); }
        env.storage().persistent().set(&Symbol::new(&env, "status"), &Symbol::new(&env, "refunded"));
        true
    }
}
`;

export const STREAMING_PAYMENT_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address};

#[contract]
pub struct StreamingPaymentContract;

#[contractimpl]
impl StreamingPaymentContract {
    pub fn initialize(env: Env, employee: Address, total_amount: i128, stream_duration_seconds: u64) {
        env.storage().persistent().set(&Symbol::new(&env, "employee"), &employee);
        env.storage().persistent().set(&Symbol::new(&env, "total_amount"), &total_amount);
        env.storage().persistent().set(&Symbol::new(&env, "start_time"), &env.ledger().timestamp());
        env.storage().persistent().set(&Symbol::new(&env, "duration"), &stream_duration_seconds);
        env.storage().persistent().set(&Symbol::new(&env, "withdrawn"), &0i128);
    }

    pub fn withdraw(env: Env, employee: Address, amount: i128) -> bool {
        employee.require_auth();
        let start_time: u64 = env.storage().persistent().get(&Symbol::new(&env, "start_time")).unwrap_or(0);
        let duration: u64 = env.storage().persistent().get(&Symbol::new(&env, "duration")).unwrap_or(0);
        let total: i128 = env.storage().persistent().get(&Symbol::new(&env, "total_amount")).unwrap_or(0);
        let withdrawn: i128 = env.storage().persistent().get(&Symbol::new(&env, "withdrawn")).unwrap_or(0);
        
        let elapsed = env.ledger().timestamp() - start_time;
        let progress = if elapsed >= duration { 100 } else { (elapsed * 100) / duration };
        
        let available = ((total * progress as i128) / 100) - withdrawn;
        if amount > available { panic!("Insufficient available balance"); }
        
        env.storage().persistent().set(&Symbol::new(&env, "withdrawn"), &(withdrawn + amount));
        true
    }
}
`;

export const MULTISIG_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address};

#[contract]
pub struct MultiSigWalletContract;

#[contractimpl]
impl MultiSigWalletContract {
    pub fn initialize(env: Env, signer1: Address, signer2: Address, signer3: Address, spending_limit: i128) {
        env.storage().persistent().set(&Symbol::new(&env, "signer1"), &signer1);
        env.storage().persistent().set(&Symbol::new(&env, "signer2"), &signer2);
        env.storage().persistent().set(&Symbol::new(&env, "signer3"), &signer3);
        env.storage().persistent().set(&Symbol::new(&env, "limit"), &spending_limit);
        env.storage().persistent().set(&Symbol::new(&env, "tx_count"), &0u64);
    }

    pub fn propose_tx(env: Env, proposer: Address, to: Address, amount: i128) -> u64 {
        proposer.require_auth();
        let tx_count: u64 = env.storage().persistent().get(&Symbol::new(&env, "tx_count")).unwrap_or(0);
        let tx_id = tx_count + 1;
        env.storage().persistent().set(&Symbol::new(&env, "tx_count"), &tx_id);
        tx_id
    }

    pub fn approve(env: Env, signer: Address, tx_id: u64) -> bool {
        signer.require_auth();
        true
    }

    pub fn execute(env: Env, tx_id: u64) -> bool {
        true
    }
}
`;

export const DAO_GOVERNANCE_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String};

#[contract]
pub struct DAOContract;

#[contractimpl]
impl DAOContract {
    pub fn initialize(env: Env, dao_name: String, voting_token: String, voting_period_seconds: u64, quorum_percentage: u32) {
        env.storage().persistent().set(&Symbol::new(&env, "name"), &dao_name);
        env.storage().persistent().set(&Symbol::new(&env, "token"), &voting_token);
        env.storage().persistent().set(&Symbol::new(&env, "voting_period"), &voting_period_seconds);
        env.storage().persistent().set(&Symbol::new(&env, "quorum"), &quorum_percentage);
        env.storage().persistent().set(&Symbol::new(&env, "proposal_count"), &0u64);
    }

    pub fn create_proposal(env: Env, proposer: Address, description: String, budget: i128) -> u64 {
        proposer.require_auth();
        let count: u64 = env.storage().persistent().get(&Symbol::new(&env, "proposal_count")).unwrap_or(0);
        env.storage().persistent().set(&Symbol::new(&env, "proposal_count"), &(count + 1));
        count + 1
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, vote: bool) {
        voter.require_auth();
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) -> bool {
        true
    }
}
`;

export const BOUNTY_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String};

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    pub fn initialize(env: Env, title: String, amount: i128, deadline_seconds: u64, judge: Address) {
        env.storage().persistent().set(&Symbol::new(&env, "title"), &title);
        env.storage().persistent().set(&Symbol::new(&env, "amount"), &amount);
        env.storage().persistent().set(&Symbol::new(&env, "judge"), &judge);
        env.storage().persistent().set(&Symbol::new(&env, "deadline"), &(env.ledger().timestamp() + deadline_seconds));
        env.storage().persistent().set(&Symbol::new(&env, "submissions"), &0u64);
    }

    pub fn submit(env: Env, contributor: Address, submission_url: String) -> u64 {
        contributor.require_auth();
        let count: u64 = env.storage().persistent().get(&Symbol::new(&env, "submissions")).unwrap_or(0);
        env.storage().persistent().set(&Symbol::new(&env, "submissions"), &(count + 1));
        count + 1
    }

    pub fn select_winner(env: Env, judge: Address, submission_id: u64) -> bool {
        judge.require_auth();
        env.storage().persistent().set(&Symbol::new(&env, "winner"), &submission_id);
        true
    }

    pub fn claim_reward(env: Env, winner: Address) -> i128 {
        winner.require_auth();
        let amount: i128 = env.storage().persistent().get(&Symbol::new(&env, "amount")).unwrap_or(0);
        amount
    }
}
`;

export const PAYMENT_SPLITTER_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address};

#[contract]
pub struct PaymentSplitterContract;

#[contractimpl]
impl PaymentSplitterContract {
    pub fn initialize(env: Env, recipient1: Address, percentage1: u32, recipient2: Address, percentage2: u32) {
        env.storage().persistent().set(&Symbol::new(&env, "recipient1"), &recipient1);
        env.storage().persistent().set(&Symbol::new(&env, "percent1"), &percentage1);
        env.storage().persistent().set(&Symbol::new(&env, "recipient2"), &recipient2);
        env.storage().persistent().set(&Symbol::new(&env, "percent2"), &percentage2);
    }

    pub fn split(env: Env, amount: i128) -> bool {
        let percent1: u32 = env.storage().persistent().get(&Symbol::new(&env, "percent1")).unwrap_or(0);
        let split1 = (amount * percent1 as i128) / 100;
        let split1_key = Symbol::new(&env, "split1_total");
        let current1: i128 = env.storage().persistent().get(&split1_key).unwrap_or(0);
        env.storage().persistent().set(&split1_key, &(current1 + split1));
        true
    }

    pub fn withdraw(env: Env, recipient: Address) -> i128 {
        recipient.require_auth();
        0
    }
}
`;

export const TOKEN_VESTING_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String};

#[contract]
pub struct VestingContract;

#[contractimpl]
impl VestingContract {
    pub fn initialize(env: Env, beneficiary: Address, token: String, amount: i128, vesting_seconds: u64) {
        env.storage().persistent().set(&Symbol::new(&env, "beneficiary"), &beneficiary);
        env.storage().persistent().set(&Symbol::new(&env, "token"), &token);
        env.storage().persistent().set(&Symbol::new(&env, "amount"), &amount);
        env.storage().persistent().set(&Symbol::new(&env, "start"), &env.ledger().timestamp());
        env.storage().persistent().set(&Symbol::new(&env, "duration"), &vesting_seconds);
        env.storage().persistent().set(&Symbol::new(&env, "claimed"), &0i128);
    }

    pub fn claim(env: Env, beneficiary: Address) -> i128 {
        beneficiary.require_auth();
        let start: u64 = env.storage().persistent().get(&Symbol::new(&env, "start")).unwrap_or(0);
        let duration: u64 = env.storage().persistent().get(&Symbol::new(&env, "duration")).unwrap_or(1);
        let total: i128 = env.storage().persistent().get(&Symbol::new(&env, "amount")).unwrap_or(0);
        let claimed: i128 = env.storage().persistent().get(&Symbol::new(&env, "claimed")).unwrap_or(0);
        
        let elapsed = env.ledger().timestamp() - start;
        let claimable = if elapsed >= duration {
            total - claimed
        } else {
            let vested = (total * (elapsed as i128)) / (duration as i128);
            vested - claimed
        };
        
        env.storage().persistent().set(&Symbol::new(&env, "claimed"), &(claimed + claimable));
        claimable
    }
}
`;

export const AIRDROP_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String};

#[contract]
pub struct AirdropContract;

#[contractimpl]
impl AirdropContract {
    pub fn initialize(env: Env, token: String, total_amount: i128, admin: Address) {
        env.storage().persistent().set(&Symbol::new(&env, "token"), &token);
        env.storage().persistent().set(&Symbol::new(&env, "total"), &total_amount);
        env.storage().persistent().set(&Symbol::new(&env, "admin"), &admin);
        env.storage().persistent().set(&Symbol::new(&env, "distributed"), &0i128);
        env.storage().persistent().set(&Symbol::new(&env, "recipient_count"), &0u64);
    }

    pub fn claim(env: Env, recipient: Address) -> i128 {
        recipient.require_auth();
        0
    }
}
`;

export const DEX_SWAP_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, String};

#[contract]
pub struct SwapContract;

#[contractimpl]
impl SwapContract {
    pub fn initialize(env: Env, token_a: String, token_b: String, reserve_a: i128, reserve_b: i128) {
        env.storage().persistent().set(&Symbol::new(&env, "token_a"), &token_a);
        env.storage().persistent().set(&Symbol::new(&env, "token_b"), &token_b);
        env.storage().persistent().set(&Symbol::new(&env, "reserve_a"), &reserve_a);
        env.storage().persistent().set(&Symbol::new(&env, "reserve_b"), &reserve_b);
    }

    pub fn swap_a_to_b(env: Env, amount_in: i128) -> i128 {
        let reserve_a: i128 = env.storage().persistent().get(&Symbol::new(&env, "reserve_a")).unwrap_or(1);
        let reserve_b: i128 = env.storage().persistent().get(&Symbol::new(&env, "reserve_b")).unwrap_or(1);
        
        let amount_out = (amount_in * reserve_b) / (reserve_a + amount_in);
        env.storage().persistent().set(&Symbol::new(&env, "reserve_a"), &(reserve_a + amount_in));
        env.storage().persistent().set(&Symbol::new(&env, "reserve_b"), &(reserve_b - amount_out));
        amount_out
    }
}
`;

export const LENDING_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String};

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
    pub fn initialize(env: Env, token: String, interest_rate_percent: u32) {
        env.storage().persistent().set(&Symbol::new(&env, "token"), &token);
        env.storage().persistent().set(&Symbol::new(&env, "interest_rate"), &interest_rate_percent);
        env.storage().persistent().set(&Symbol::new(&env, "total_deposits"), &0i128);
    }

    pub fn deposit(env: Env, depositor: Address, amount: i128) {
        depositor.require_auth();
    }
}
`;

export const STAKING_TEMPLATE = `
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, String};

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    pub fn initialize(env: Env, token: String, reward_rate_percent: u32) {
        env.storage().persistent().set(&Symbol::new(&env, "token"), &token);
        env.storage().persistent().set(&Symbol::new(&env, "reward_rate"), &reward_rate_percent);
        env.storage().persistent().set(&Symbol::new(&env, "total_staked"), &0i128);
    }

    pub fn stake(env: Env, staker: Address, amount: i128) {
        staker.require_auth();
    }
}
`;
