---
name: stellar-core
description: Key guidelines and templates for Soroban smart contract development, including storage types, authorization patterns, and test configurations.
---

# 🛠️ Soroban Smart Contract Core Building Blocks

Essential patterns for storage, authorization, and testing on Stellar/Soroban.

---

## 💾 1. Contract Storage Choices

Soroban provides three storage zones. Always choose the one matching your data lifecycle:

| Storage Type | API Call | Cost | TTL Expiration Behavior | Key Volume | Ideal Use Case |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **Temporary** | `env.storage().temporary()` | Low | Removed forever (deleted) | Unlimited | Nonces, flash loan markers, short-term approvals. |
| **Persistent** | `env.storage().persistent()` | High | Archived (restorable) | Unlimited | User balances, escrows, state variables. |
| **Instance** | `env.storage().instance()` | Medium | Archived (restorable) | Limited by size | Admin address, contract configs, global coefficients. |

### TTL Extension Example
Ensure to extend the TTL (Time-To-Live) for critical keys:
```rust
// Extend instance storage TTL to at least 100,000 ledgers
env.storage().instance().extend_ttl(100_000, 100_000);
```

---

## 🔐 2. Authorization & Signature-Agnostic Auth

To enforce caller validation, use signature-agnostic `require_auth()` or `require_auth_for_args()`:

```rust
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct SecureVault;

#[contractimpl]
impl SecureVault {
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        // Enforces signature verification (supports keys, multisig, and passkeys)
        user.require_auth();
        
        // Execute withdrawal logic...
    }
}
```

---

## 🧪 3. Writing Soroban Unit Tests

Use `soroban-sdk` test environments to mock state and bypass signature validation during testing:

```rust
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, Address};

    #[test]
    fn test_vault_withdraw() {
        let env = Env::default();
        env.mock_all_auths(); // Auto-approves require_auth() calls

        let contract_id = env.register_contract(None, SecureVault);
        let client = SecureVaultClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        client.withdraw(&user, &1000);

        // Verification assertions
    }
}
```

---

## 🛠️ 4. Core Stellar Developer Tools Quick Reference

*   **Stellar CLI (`stellar`)**:
    *   Optimize WASM: `stellar contract optimize --wasm <path>`
    *   Deploy Contract: `stellar contract deploy --wasm <optimized_path> --source <secret> --network <testnet/mainnet>`
    *   Invoke Method: `stellar contract invoke --id <contract_id> --source <secret> --network <network> -- <method> --arg1 <val>`
*   **Stellar Lab** (`https://laboratory.stellar.org`): The interactive browser GUI to generate keypairs, request Friendbot testnet XLM funding, inspect XDR objects, and build/submit transactions manually.
*   **Stellar Wallets Kit** (`@stellar/wallets-kit`): The unified front-end SDK connecting Freighter, xBull, Albedo, Hana, and LOBSTR wallets through a single TypeScript interface.
*   **OpenZeppelin on Stellar**: Canonical repository of audited smart contract blueprints (Tokens, Access Control, Pausable, Vesting) tailored specifically for Soroban.

