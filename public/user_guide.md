# Stellar WhatsApp Bot: Comprehensive User Guide

Welcome to the **Stellar WhatsApp AI Bot**! This guide covers everything from setting up your wallet to performing zero-knowledge confidential transfers and deploying custom smart contracts.

---

## 🚀 1. Getting Started & Onboarding

When you first message the bot on WhatsApp, you will receive a welcome message. Reply **"create wallet"** to initialize your secure Stellar wallet.

### Commands to Try:
* **"create wallet"** — Securely generates and initializes your personal Stellar wallet.
* **"What is my wallet address?"** — Returns your Stellar public key (G-address).
* **"Activate my account"** — Funds your testnet Stellar account with XLM and configures the default USDC trustline so you are ready to receive assets.
* **"Save contact [Name] [Phone Number]"** — Adds a contact to your address book. (e.g. `Save contact Bob +919048696859`).

---

## 💸 2. Public Transactions & Balances

Standard transactions are public, settled directly on the Stellar testnet, and fully visible on any block explorer.

### Commands to Try:
* **"Check my balance"** — Lists your current XLM and USDC balances.
* **"Send 10 USDC to Bob"** — Resolves Bob's name to his phone number, checks that he has a wallet, asks you for confirmation, and executes the transfer.
* **"Swap 10 XLM to USDC"** — Swaps assets instantly on the Stellar decentralized exchange (DEX).

---

## 🔒 3. ZK Confidential Transfers (Private Transactions)

Confidential transactions hide the sender, recipient, and transfer amount on the blockchain using **Pedersen commitments** and **UltraHonk zero-knowledge proofs**.

### Step-by-Step Private Flow:

1. **Register (`confidential_register`)**:
   * Text: **"Register me for XLM confidential"** (or **"USDC"**).
   * *Under the hood*: Generates Grumpkin viewing/spending keys derived deterministically from your private key and binds them to the token contract.
2. **Deposit (`confidential_deposit`)**:
   * Text: **"Deposit 20 XLM confidential"**.
   * *Under the hood*: Moves public tokens into your private receiving ZK balance.
3. **Merge (`confidential_merge`)**:
   * Text: **"Merge my XLM confidential balance"**.
   * *Under the hood*: Merges your receiving balance into your spendable private balance.
4. **Transfer (`confidential_transfer`)**:
   * Text: **"Send 10 XLM confidentially to Bob"**.
   * *Under the hood*: Generates a Noir ZK proof and transfers tokens privately. Bob must be registered.
5. **Withdraw (`confidential_withdraw`)**:
   * Text: **"Withdraw 5 XLM confidential to G..."**.
   * *Under the hood*: Converts private ZK tokens back to public XLM at any target address.

---

## 🏗️ 4. Smart Contracts & Deployments

You can write, compile, and deploy custom Soroban Rust contracts directly through the chat.

### Dynamic Compiler Templates:
Describe the contract you want to deploy, and the bot will conduct a step-by-step interview to gather details:
* **Token/Coin**: Collects Name, Ticker symbol, Initial supply, and Decimals.
* **NFT Collection**: Collects Collection name, Ticker symbol, Max supply, and Admin.
* **Escrow**: Locks USDC/XLM in a secure vault, released by a third-party Arbiter.

### Interactive Escrow Flow:
1. Ask: **"Deploy an escrow contract"**.
2. The bot will guide you through collecting the **Recipient**, **Arbiter**, and **Locked Amount**.
3. It will present a summary for you to verify. Reply **"Confirm"** to deploy.

---

## 🎓 5. Developer Tools & Audits

Get professional assistance with Web3 development directly in WhatsApp:
* **"Audit this contract"** followed by your Rust or Solidity code. The bot will run a security scan and report vulnerabilities (Critical, Medium, gas optimizations) with code fixes.
* **"List skills"** — Shows the active developer guides available in the workspace.
* **"Read skill smart-contracts"** — Pulls down comprehensive Soroban SDK references, storage instructions, and syntax rules.

---

## 🗺️ 6. Product Roadmap (Upcoming Features)

The following capabilities are currently under development and will be released in upcoming versions:
* **Cross-Chain CCTP Bridge (Circle)**: Bridge USDC seamlessly between EVM networks (like Base Sepolia) and Stellar Testnet. This will allow commands like *"Bridge 15 USDC from EVM"* to burn USDC on EVM and mint it on Stellar automatically.

