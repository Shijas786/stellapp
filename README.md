<div align="center">

# 🌌 StellApp

### Chat. Build. Pay. On Stellar.

[StellApp](https://stellapp.net) brings the complete power of the **Stellar & Soroban** blockchains directly to WhatsApp — using natural language (text + voice), an AI agent loop, and zero-knowledge confidential transfers.

---

## ⚡ Try it now

**Message our live bot on WhatsApp → [+91 7012751478](https://wa.me/917012751478?text=create%20wallet)**

> Send *"create wallet"* to get a Stellar wallet in seconds. No app, no seed phrase.

---

[![Stellar Network](https://img.shields.io/badge/Stellar-Testnet-black.svg?style=flat&logo=stellar&logoColor=white&color=080808)](https://stellar.org)
[![Circom ZK](https://img.shields.io/badge/Circom-Zero%20Knowledge-yellow.svg?style=flat&logo=webassembly&logoColor=white&color=f4e931)](https://github.com/iden3/circom)
[![WhatsApp Bot](https://img.shields.io/badge/Start%20on%20WhatsApp-25D366.svg?style=flat&logo=whatsapp&logoColor=white)](https://wa.me/917012751478?text=create%20wallet)
[![TypeScript](https://img.shields.io/badge/TypeScript-informational?style=flat&logo=typescript&logoColor=white&color=3178C6)](https://www.typescriptlang.org/)
[![Next.js 14](https://img.shields.io/badge/Next.js%2014-informational?style=flat&logo=next.js&logoColor=white&color=000000)](https://nextjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-informational?style=flat&logo=prisma&logoColor=white&color=2D3748)](https://prisma.io)

</div>

---

## 🤖 What is StellApp?

StellApp is a **WhatsApp-native Stellar privacy wallet and developer platform**. Users interact entirely through chat — no browser extension, no app install, no seed phrase management. An AI agent interprets natural language and routes commands to execute zero-knowledge privacy pool deposits/withdrawals, confidential peer-to-peer transfers, automated recurring payments, smart contract deployment, and token swaps.

---

## 🛠️ Key Features

- **🛡️ ZK Privacy Pool (Circom + Groth16)**
  Deposit tokens into a shared anonymity pool and withdraw them to any clean, unlinkable recipient address. The withdrawer presents a public nullifier and a Groth16 membership ZK proof, making the sender and receiver completely unlinkable on-chain.

- **🔒 Confidential Transfers (Shielded Balances)**
  Perform direct peer-to-peer transfers where amounts and balances are fully encrypted on-chain. Blinding factors and commitments are kept secure, and zero-knowledge range proofs verify the validity of transactions without exposing underlying values.

- **⏰ Automated Recurring Payments (Cron Jobs)**
  Schedule automated recurring payments directly through natural language WhatsApp commands. An active background worker tracks time intervals and automates scheduled wallet executions trustlessly.

- **🛠️ Dynamic Smart Contract Builder & Deployer**
  Describe what you want ("create a payment splitter", "deploy a time-locked vault Vault"). The AI agent automatically generates Soroban Rust code, compiles it to WASM, uploads the binary, and instantiates the contract on-chain—all inside the chat.

- **🔄 Asset Management & DEX Swaps**
  Manage classic Stellar assets, establish trustlines, and perform instant swaps and trades using Stellar's native decentralized exchange (DEX).

---

## 📐 Architecture

```mermaid
graph TD
    subgraph User Interaction
      A[WhatsApp User] -->|WhatsApp-Web.js| B[Bot Server]
      B -->|Voice/Txt| C(OpenAI Whisper & GPT Agent)
      B -->|SMS/Groups| D(Integrations)
    end

    subgraph Bot Server
      B -->|JWT Auth| E[Express API]
      B -->|Stellar SDK| F[Stellar Horizon/RPC]
      B -->|Noir/Circom| G[ZK Circuits]
      B -->|Postgres + Prisma| H[(Database)]
    end

    subgraph Stellar Network
      F -->|Submit TX| I(Stellar Ledger & Soroban)
      I -->|State Updates| G
    end

    subgraph ZeroKnowledge
      G -->|Proving/Verifying| I
    end

    H ---|Stores keys & data| B
```

---

## 📐 Flow Diagrams

### 1. Inbound Text/Voice Request Flow
```mermaid
sequenceDiagram
    actor User as WhatsApp User
    participant WA as WhatsApp Web Client
    participant Bot as StellApp Service (Node.js)
    participant Whisper as OpenAI Whisper API
    participant Agent as AI Agent Loop
    participant SDK as Stellar SDK

    User->>WA: Sends Voice Note (PTT)
    WA->>Bot: Download Audio (.ogg)
    Bot->>Whisper: Transcribe Audio
    Whisper-->>Bot: "send 10 USDC to Bob"
    Bot->>Agent: Process text prompt + tools context
    Agent-->>Bot: Selects tool "send_stellar"
    Bot->>Agent: Ask user to confirm transfer
    Agent-->>Bot: User confirms
    Bot->>SDK: Build & Sign Transaction
    SDK-->>Bot: Transaction Success
    Bot->>User: "Successfully transferred 10 USDC to Bob!"
```

### 2. ZK Privacy Pool Flow
```mermaid
sequenceDiagram
    autonumber
    actor Alice as Alice (Depositor)
    participant WA as WhatsApp Bot
    participant DB as Postgres DB
    participant Pool as Privacy Pool Contract
    actor Bob as Bob (Receiver)

    Note over Alice, WA: Alice deposits 100 USDC into the privacy pool
    Alice->>WA: "deposit 100 USDC into privacy pool"
    WA->>WA: Generate secrets: Nullifier + Secret
    WA->>WA: Compute commitment: Hash(Nullifier, Secret)
    WA->>DB: Save Nullifier, Secret, Commitment (encrypted)
    WA->>Pool: deposit(100 USDC, Commitment)
    Pool->>Pool: Verify USDC transfer, insert Commitment into Merkle Tree
    Note over Pool: Commitment is now stored on-chain
    
    Note over WA, Bob: Bob withdraws securely to a clean address
    Bob->>WA: "withdraw from privacy pool"
    WA->>WA: Retrieve secret details & fetch Merkle path
    WA->>WA: Generate Groth16 ZK-SNARK Proof of membership
    WA->>Pool: withdraw(Clean Recipient Address, Nullifier, ZK-Proof)
    Pool->>Pool: Verify ZK-Proof against Merkle Root
    Pool->>Pool: Check Nullifier has not been spent (prevent double spend)
    Pool->>Pool: Store Nullifier as spent
    Pool->>Clean Recipient Address: Transfer 100 USDC
    Note over Bob: Bob receives funds with zero link to Alice
```

### 3. Confidential Transfer Flow
```mermaid
sequenceDiagram
    autonumber
    actor Alice as Alice (Sender)
    participant WA as WhatsApp Bot
    participant DB as Postgres DB
    participant CT as Confidential Token Contract
    actor Bob as Bob (Receiver)

    Note over Alice, WA: Alice transfers encrypted balance to Bob
    Alice->>WA: "send 50 USDC privately to Bob"
    WA->>DB: Fetch Alice's keys & Bob's public key
    WA->>WA: Derive shared secret via ECDH
    WA->>WA: Encrypt transfer amount (Ciphertext)
    WA->>WA: Generate ZK Range Proof (verifies amount > 0 and balance >= amount)
    WA->>CT: transferConfidential(Bob, Ciphertext, ZK-Proof)
    CT->>CT: Verify ZK Range Proof against Alice's encrypted balance
    CT->>CT: Update Alice's encrypted balance
    CT->>CT: Update Bob's encrypted balance
    Note over CT: On-chain balances updated privately
    Bob->>WA: "check private balance"
    WA->>DB: Fetch Bob's private key
    WA->>WA: Retrieve Bob's encrypted balance from contract
    WA->>WA: Decrypt balance using Bob's private key
    WA-->>Bob: "Your private balance is 150 USDC"
```

### 4. Dynamic Smart Contract Builder & Deployer Flow
```mermaid
sequenceDiagram
    autonumber
    actor Developer as Developer (User)
    participant WA as WhatsApp Bot
    participant LLM as AI Agent (GPT-4o)
    participant Compiler as Compiler Service (Rust)
    participant CLI as Stellar SDK / CLI
    participant Chain as Soroban Blockchain

    Note over Developer, WA: Developer describes the desired contract logic
    Developer->>WA: "deploy a vault contract locking funds for 30 days"
    WA->>LLM: Process natural language prompt & contract request
    Note over LLM: LLM identifies contract requirements & generates Rust Soroban code
    LLM-->>WA: Return generated Soroban Rust source code
    WA->>Compiler: Send source code for dynamic build
    Compiler->>Compiler: Prepare workspace & add dependencies
    Compiler->>Compiler: Run cargo build --target wasm32v1-none --release
    Compiler-->>WA: Return compiled contract.wasm binary bytes
    WA->>Developer: "Vault contract compiled! Reply with 'confirm' to deploy."
    Developer->>WA: "confirm"
    WA->>CLI: Initiate on-chain deployment
    CLI->>Chain: Submit WASM upload transaction (Install contract)
    Chain-->>CLI: Return installed WASM registry hash
    CLI->>Chain: Submit instantiation transaction (Create instance ID)
    Chain-->>CLI: Return deployed Contract ID
    CLI-->>WA: Return confirmation details & on-chain contract address
    WA->>Developer: "Successfully deployed! Contract Address: CC123..."
```

## 📁 Repository Structure

```
stellapp/
├── circuits/                 # Circom ZK circuits, compiled R1CS, proving keys
│   ├── privacy_pool.circom   # Privacy pool circuit (register / transfer / withdraw)
│   └── verification_key.json # Public verification key
├── contracts/                # Rust/Soroban smart contract source
│   └── privacy_pool/         # On-chain ZK privacy pool contract
├── contracts_wasm/           # Pre-compiled WASM binaries
│   └── confidential_token.wasm
├── compiler_template/        # Cargo workspace used for dynamic contract compilation
├── dashboard/                # Next.js 14 landing page & roadmap
├── prisma/                   # PostgreSQL schema (users, contacts, ZK registries)
│   └── schema.prisma
└── src/
    ├── agent/                # OpenAI agent loop, prompt, tool definitions
    ├── bot/                  # WhatsApp Web client & message router
    ├── services/             # Stellar SDK, compiler, encryption, ZK pool
    └── zk/                  # ZK prover, state engine, crypto primitives
```

---

## 🚀 Local Setup

### Prerequisites

1. **Node.js** v18+
2. **Rust & Cargo** (stable)
3. **WASM target for Soroban** — note: Soroban requires `wasm32v1-none`, not `wasm32-unknown-unknown`:
   ```bash
   rustup target add wasm32v1-none
   ```
4. **PostgreSQL** (local or [Railway](https://railway.app))

### Installation

```bash
# 1. Clone & install
git clone https://github.com/Shijas786/stellapp.git
cd stellapp
npm install

# 2. Configure environment
cp .env.example .env
# Fill in your values (see variable reference below)

# 3. Push database schema
npx prisma db push

# 4. Start development server
npm run dev

# 5. Scan the QR code shown in the terminal with WhatsApp on your phone
```

### Environment Variables

```env
# Network: "TESTNET" or "MAINNET"
STELLAR_NETWORK="TESTNET"

# PostgreSQL connection string
DATABASE_URL="postgresql://user:password@localhost:5432/stellapp"

# 32-byte hex key for AES-256-GCM wallet encryption
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY="your-32-byte-hex-key"

# OpenAI
OPENAI_API_KEY="sk-proj-..."
OPENAI_MODEL="gpt-4o"

# Stellar endpoints (defaults work for testnet)
STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org"
STELLAR_RPC_URL="https://soroban-testnet.stellar.org"

# USDC issuer on Stellar Testnet
USDC_ISSUER_ADDRESS="GBBD4QNSTNAA2MA2LIADO57IL3ZCYCVW27566TC4H7SV23R3CQDU4VE3"
```

---

## 🛡️ Security Architecture

1. **AES-256-GCM Encryption**: All custodial seed phrases and private keys are encrypted at the database level before write operations.
2. **Self-Healing ZK State Sync**: Off-chain blinding factors and balance openings are continuously cross-verified with on-chain commitments. Any drift automatically triggers a full state recovery.
3. **Issuer Key Lock**: Custom-deployed tokens permanently lock their minting and authorization keys during creation to prevent unauthorized token inflation.
4. **Non-Custodial Design**: Users own their Stellar keys. The bot encrypts and stores them — but can never move funds without a user-confirmed transaction instruction.

---

<div align="center">
Built for the Stellar & ZK Privacy ecosystems.
</div>
