
#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, symbol_short};

#[contract]
pub struct HelloContract;

#[contractimpl]
impl HelloContract {
    pub fn hello(env: Env, to: Symbol) -> soroban_sdk::Vec<Symbol> {
        soroban_sdk::vec![&env, symbol_short!("Hello"), to]
    }
}
