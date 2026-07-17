# StellApp ZK Confidential Transfers Guide

StellApp implements ZK Confidential Transfers (Encrypted Balances) on the Stellar network.

This document explains the architecture and implementation details for ZK Confidential Transfers.

---

## 1. ZK Confidential Transfers (Encrypted Balances)

Confidential Transfers use homomorphic encryption to hide transaction amounts and account balances on-chain while verifying that the sender has sufficient funds.

* **Registration**: The user registers their public key in the contract to initialize a confidential account.
* **Wrap (Confidential Deposit)**: Converts public USDC into encrypted private balances.
* **Transfer**: Sends encrypted tokens to another registered user. Only the sender and recipient can decrypt the amount and their own balances.
* **Merge**: If a user receives multiple confidential transfers, they merge them to combine the encrypted balance payloads.
* **Unwrap (Confidential Withdraw)**: Converts encrypted private balances back into standard public USDC.
