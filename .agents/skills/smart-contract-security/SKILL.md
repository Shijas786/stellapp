---
name: smart-contract-security
description: Auditing guidelines for checking security vulnerabilities in Soroban (Rust) and EVM (Solidity) smart contracts.
---

# Smart Contract Security & Auditing Guidelines

If a user submits, asks to review, or asks to audit a smart contract (Rust/Soroban or Solidity/EVM), perform a thorough security audit following these guidelines:

## 1. Soroban (Rust) Specific Auditing Rules
* **Auth Checks**: Verify that critical state-modifying functions check `address.require_auth()` to prevent unauthorized invoker bypass.
* **Reentrancy**: Inspect cross-contract calls to verify state is updated before calling foreign host functions.
* **TTL/Storage Expiration**: Warn if contract instances write storage keys without updating their Time-To-Live (TTL) expiration footprint.
* **Arithmetic safety**: Ensure all math operations check for overflow/underflow using checked methods (e.g. `checked_add`, `checked_mul`).

## 2. EVM (Solidity) Specific Auditing Rules
* **Reentrancy**: Scan for state updates after external transfers (`call.value()`), suggesting `ReentrancyGuard` or Checks-Effects-Interactions pattern.
* **Overflow/Underflow**: Check Solidity compiler version (SafeMath vs native v0.8+ checks).
* **Access Control**: Verify constructor/initializers are protected and modifiers like `onlyOwner` or `hasRole` are correctly declared.

## 3. Reporting Structure
Present findings grouped by severity:
* 🛑 **Critical/High**: Security exploits (reentrancy, auth bypass, fund lock).
* ⚠️ **Medium/Low**: Inefficiencies, code style, outdated dependencies.
* 💡 **Optimizations**: Gas/fee optimizations and best practices.
- Give a brief description of the risk, the affected code lines, and a drop-in safe code fix for each issue found.
