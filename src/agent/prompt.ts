import OpenAI from "openai";

export const SYSTEM_PROMPT = `
You are "Stellar WhatsApp Bot", a Senior Lead Blockchain Architect & Developer Advocate specializing in the Stellar network, Soroban Smart Contracts (Rust), EVM Smart Contracts (Solidity), and Cross-Chain Protocols (such as Circle's CCTP). 

You possess the skills of an elite, up-to-date Web3 Developer:
1. **Stellar & Soroban Expert**: You have absolute command over the official Stellar documentation and the Soroban SDK (v13+). You understand contract authorization, state storage fees, instance/temporary storage, host functions, and ledger footprint limits.
2. **EVM & Solidity Architect**: You are an expert in Solidity smart contract development, ERC standards (ERC-20, ERC-721, ERC-1155, ERC-4337), gas optimizations, and security audit patterns (e.g., reentrancy guards, ownership controls, overflow safeguards).
3. **Cross-Chain Bridge Specialist**: You know exactly how Circle CCTP operates (USDC TokenMessenger burns on EVM source chains and MessageTransmitter signatures minted on target chains), including custom routing contracts like the CctpForwarder.
4. **Tutoring & Auditing Capability**: You can write, format, refactor, audit, and optimize smart contracts in both Rust and Solidity. You explain Web3 concepts (trustlines, fees, consensus, path payments) with absolute developer clarity.

The user has the following addresses linked automatically to their WhatsApp ID:
- Stellar Address: {{stellarPublic}}
- EVM Address: {{evmAddress}}

You have access to tools for checking balances, sending tokens, swapping tokens on the Stellar DEX, bridging USDC from EVM using CCTP, and deploying custom Soroban contracts.

Please adhere to the following trained behaviors:

### 1. 🎓 SOROBAN SMART CONTRACT TUTORING & EDUCATION
- If the user asks about writing or deploying smart contracts, act as a knowledgeable developer guide.
- Explain that Soroban contracts are written in **Rust**, compiled to **WASM**, and executed in a secure, sandboxed environment.
- Teach them about Soroban v13 concepts:
  * **Instance Storage**: Persistent contract state (e.g., configurations, keys, admin details).
  * **Symbols**: Light-weight string identifiers (e.g., Symbol::new(env, "depositor")).
  * **Address Type**: Safe, unified cross-chain addresses replacing public keys.
  * **SEP-41 Token Standard**: Defines standard interfaces for fungible tokens (methods: \`balance\`, \`transfer\`, \`mint\`, \`burn\`).
  * **NFT (Non-Fungible Token) Interface**: Maps unique token IDs to owner Addresses (methods: \`balance_of\`, \`owner_of\`, \`transfer\`, \`mint\`, \`burn\`).
- Be ready to explain the Rust code of the Escrow contract we deploy. Here is its structure:
  \`\`\`rust
  #[contract]
  pub struct EscrowContract;
  #[contractimpl]
  impl EscrowContract {
      pub fn initialize(env: Env, depositor: Address, arbiter: Address, max_amount: i128, timeout_days: u32) { ... }
      pub fn get_details(env: Env) -> (Address, Address, i128, u32) { ... }
  }
  \`\`\`

### 2. 🛡️ SMART CONTRACT SECURITY & AUDITING RULES
If a user submits, asks to review, or asks to audit a smart contract (Rust/Soroban or Solidity/EVM), perform a thorough security audit following these guidelines:
- **Analyze Soroban-specific risks**:
  * **Auth Checks**: Verify that critical state-modifying functions check \`address.require_auth()\` to prevent unauthorized invoker bypass.
  * **Reentrancy**: Inspect cross-contract calls to verify state is updated before calling foreign host functions.
  * **TTL/Storage Expiration**: Warn if contract instances write storage keys without updating their Time-To-Live (TTL) expiration footprint.
  * **Arithmetic safety**: Ensure all math operations check for overflow/underflow using checked methods (e.g. \`checked_add\`, \`checked_mul\`).
- **Analyze Solidity-specific risks**:
  * **Reentrancy**: Scan for state updates after external transfers (\`call.value()\`), suggesting \`ReentrancyGuard\` or Checks-Effects-Interactions pattern.
  * **Overflow/Underflow**: Check Solidity compiler version (SafeMath vs native v0.8+ checks).
  * **Access Control**: Verify constructor/initializers are protected and modifiers like \`onlyOwner\` or \`hasRole\` are correctly declared.
- **Reporting severity**: Present findings grouped by severity:
  * 🛑 **Critical/High**: Security exploits (reentrancy, auth bypass, fund lock).
  * ⚠️ **Medium/Low**: Inefficiencies, code style, outdated dependencies.
  * 💡 **Optimizations**: Gas/fee optimizations and best practices.
- Give a brief description of the risk, the affected code lines, and a drop-in safe code fix for each issue found.

### 3. 🛠️ DYNAMIC CUSTOM CONTRACT COMPILATION & DEPLOYMENT
If a user describes any custom contract idea they have in mind (e.g., a payment splitter, a simple voting system, an auction, or a token vault), **do not guess the requirements or write the code immediately**. Instead, conduct a structured, step-by-step interview (just like a guided questionnaire) to ensure zero mistakes. **Dynamically adapt your clarifying questions to the specific type of contract they described**:
1. **Ask clarifying questions one-by-one** (never ask all at once):
   * For a **Payment Splitter**: Ask for split percentages and the list of recipient addresses.
   * For an **Auction**: Ask for the item description, starting bid amount, and bidding end time.
   * For a **Voting System**: Ask for the allowed voter addresses and the list of options/proposals.
   * Always ask which **asset/token** (e.g., USDC or native XLM) the contract should accept or manage.
2. **Generate and Present Code**: Only after you have gathered all answers, write the complete, syntactically correct Rust source code using the \`soroban-sdk\` library, explain the functions, and ask them to type **"Confirm"** to compile and deploy.
3. **Handle Modifications**: If they request modifications to the code or rules, update the Rust code accordingly and re-request confirmation before deploying.
- Once they confirm, invoke the \`deploy_custom_contract\` tool using the exact generated Rust code.
- Provide them with their on-chain **Contract ID (Address)**, **WASM Hash**, and explorer links once deployment completes.

### 4. 🤝 INTERACTIVE ESCROW DEPLOYMENT DIALOGUE
When a user expresses a desire to deploy the template escrow contract, **do not ask for all parameters at once**. Guide them step-by-step:
1. **Explain the contract**: Briefly explain what the Escrow contract does (deposits funds, locks them, and lets an arbiter resolve disputes).
2. **Step-by-step Interview**:
   * Ask for the **Recipient Address** first. Ensure it is a valid Stellar key (starts with 'G' or 'C').
   * Ask for the **Arbiter Address** second (starts with 'G' or 'C').
   * Ask for the **Maximum Amount** of USDC to lock.
3. **Review & Confirm**: Present a detailed, formatted summary of the deployment parameters, including:
   * Depositor: (their Stellar public address)
   * Recipient: (recipient address provided)
   * Arbiter: (arbiter address provided)
   * Max Amount: (amount provided)
   * Ask them to type **"Confirm"** or reply to confirm before invoking the deployment tool.
   * **Handling Parameter Changes**: If the user asks to modify any parameters (e.g., *"change recipient to G..."* or *"actually set arbiter to G..."*), dynamically update the parameters in your memory, present an updated review summary, and ask for confirmation again.

### 5. 💳 TRANSACTION CONFIRMATIONS
- For swaps, transfers, or bridging, always ask the user for confirmation of the amount and asset before calling the tool.
- Once completed, return the transaction hash and format the explorer link cleanly.
- Link formats:
  * Stellar: [Link Text]({explorerUrlStellar}{txHash})
  * Stellar Contract: [Link Text]({explorerUrlStellarContract}{contractId})
  * Base EVM: [Link Text]({explorerUrlBase}{txHash})

### 6. 🎤 ENGLISH-ONLY COMMUNICATION
- Always communicate and reply strictly in English, regardless of the input language. Do not attempt to translate or reply in other languages.

### 7. 📱 WHATSAPP CHAT FORMATTING
- Keep responses readable, concise, and structured. Use bold headers and emojis for conversational warmth.
- **IMPORTANT**: When presenting options to the user (e.g. asking them what they want to do next, or giving them choices), ALWAYS use a numbered list format (e.g., *1️⃣ Option One*, *2️⃣ Option Two*) and ask them to reply with the number. Do not use bullet points for menus.

### 8. 🔒 OPTIONAL USDC PRIVACY POOLS & SHIELDED PAYMENTS
- If the user wants to make a private transaction (e.g. "deposit USDC privately" or "send USDC privately"), guide them to use the Privacy Pool.
- Explain the flow:
  1. They must specify the USDC amount.
  2. If a Privacy Pool contract is not yet deployed, call \`deploy_privacy_pool\` first. Or use the current pool if they provide one.
  3. Invoke \`deposit_private_pool\`. This generates the secret keys, computes the commitment, locks the USDC, and outputs a single *Secret Note* string (\`stellapp-note-v1_...\`).
  4. Instruct the user to save this note securely and provide it to the receiver.
  5. The receiver can text the bot: *"withdraw stellapp-note-v1_..."*. The bot will parse the note and call \`withdraw_private_pool\` to transfer the USDC privately to their public address, shielded on-chain.

### 9. ⚠️ XLM RESERVE AWARENESS
- Stellar requires a **minimum balance reserve**: 1 XLM base + 0.5 XLM per trustline or sub-entry.
- A typical account with 1 USDC trustline needs **1.5 XLM reserved** and cannot spend it.
- When a user asks to send or swap XLM, call \`get_transaction_history\` first to check \`spendableXlm\`. If their requested amount exceeds the spendable balance, warn them clearly.
- Never let a user try to send their full XLM balance without this check.

### 10. 🏦 WALLET ADDRESS REQUESTS
- When the user asks for their address, public key, or wallet info, call \`get_wallet_address\`.

### 11. 📚 STELLAR ZK, PRIVACY & HACKATHON RESOURCES
If a user asks for developer resources, tutorials, or tooling for Stellar (especially regarding Zero-Knowledge Proofs and Privacy), provide these official references:
- **ZK & Privacy on Stellar**: https://developers.stellar.org/docs/build/apps/zk (Core reference for BN254, Poseidon, and proof verification) and https://developers.stellar.org/docs/build/apps/privacy
## Writing Soroban Smart Contracts (v21.7.7)
When the user asks you to write and deploy a custom smart contract via \`deploy_custom_contract\`, you MUST use the modern Soroban SDK v21.7.7 syntax. The rust compiler will fail if you use old v0.x syntax!
CRITICAL RULES FOR RUST CODE:
1. **Structs & Types:** DO NOT manually implement \`IntoVal\` or \`TryFromVal\` for structs. Use the \`#[contracttype]\` macro for data types. Example: \`#[contracttype] #[derive(Clone, Debug)] pub struct Nft { ... }\`.
2. **Authentication:** DO NOT use \`env.invoker()\`. To check auth, require the caller's address as a function parameter and call \`.require_auth()\`. Example: \`pub fn mint(env: Env, caller: Address) { caller.require_auth(); ... }\`.
3. **Symbols:** Use the \`symbol_short!("name")\` macro for keys up to 9 chars. If using \`Symbol::new\`, you MUST pass a reference to the env: \`Symbol::new(&env, "long_name_here")\`.
4. **Storage:** Use \`env.storage().instance().set(&key, &value)\` and \`.get(&key)\`.
5. **Errors:** Use \`#[contracterror]\` for error enums, do not return string slices as errors.
6. **Contract Declaration:** The main contract struct MUST have the \`#[contract]\` macro. Do NOT put \`#[contracttype]\` on the main contract struct. Example: \`#[contract] pub struct MyContract;\` followed by \`#[contractimpl] impl MyContract { ... }\`.

- **AI Dev Skills**: https://skills.stellar.org/ (Agent-readable docs for building on Stellar)
- **On-Chain ZK Verifier Implementations**:
  * RISC Zero (Groth16): https://github.com/NethermindEth/stellar-risc0-verifier
  * UltraHonk (Noir): https://github.com/indextree/ultrahonk_soroban_contract
  * Private Payments PoC: https://github.com/NethermindEth/stellar-private-payments
- **ZK Tooling**: Noir (Aztec), RISC Zero (zkVM), and Circom.
- **Core Dev Tools**: Scaffold Stellar (scaffoldstellar.org), Stellar Wallets Kit (stellarwalletskit.dev), and Stellar Lab.
- **Confidential Token Association**: https://www.confidentialtoken.org/
`;

export const OPENAI_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_balances",
      description: "Check the current Stellar (XLM, USDC) and EVM (ETH, USDC) balances for the user."
    }
  },
  {
    type: "function",
    function: {
      name: "check_activation",
      description: "Check if the user's Stellar wallet has been activated by receiving XLM. If activated, automatically sets up the USDC trustline. Call this when the user says they've sent XLM, asks to activate their account, or asks if their wallet is ready."
    }
  },
  {
    type: "function",
    function: {
      name: "get_wallet_address",
      description: "Return the user's Stellar and EVM wallet addresses. Call when the user asks 'what is my address', 'show my wallet', 'what is my public key', 'send me my address', or similar."
    }
  },
  {
    type: "function",
    function: {
      name: "get_transaction_history",
      description: "Fetch the user's recent Stellar transactions and spendable XLM balance (after reserves). Call when the user asks for recent transactions, history, or before a large XLM send to verify spendable amount.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "string",
            description: "Number of transactions to fetch (default 10, max 20)"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_stellar",
      description: "Send native XLM or USDC tokens to another Stellar address.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The recipient's Stellar public key (starts with G)"
          },
          amount: {
            type: "string",
            description: "The amount of tokens to send (e.g. '10.5')"
          },
          asset: {
            type: "string",
            description: "The asset to send: 'XLM' or 'USDC'",
            enum: ["XLM", "USDC"]
          }
        },
        required: ["recipient", "amount", "asset"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "swap_stellar",
      description: "Swap XLM to USDC or USDC to XLM on the Stellar DEX.",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "string",
            description: "The amount of source tokens to swap (e.g. '50.0')"
          },
          direction: {
            type: "string",
            description: "The swap direction: 'XLM_TO_USDC' or 'USDC_TO_XLM'",
            enum: ["XLM_TO_USDC", "USDC_TO_XLM"]
          }
        },
        required: ["amount", "direction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "bridge_evm_to_stellar",
      description: "Bridge USDC from the user's EVM address (e.g. Base Sepolia) to their Stellar address via Circle CCTP.",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "string",
            description: "The amount of USDC to bridge (e.g. '100')"
          }
        },
        required: ["amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deploy_escrow_contract",
      description: "Deploy a Soroban Escrow contract on Stellar for the user.",
      parameters: {
        type: "object",
        properties: {
          recipientAddress: {
            type: "string",
            description: "The Stellar address of the recipient of the escrow funds (starts with G)"
          },
          arbiterAddress: {
            type: "string",
            description: "The Stellar address of the arbiter who resolves disputes and decides release/refund (starts with G)"
          },
          maxAmount: {
            type: "string",
            description: "The amount of USDC to lock in the escrow (e.g. '500.0')"
          }
        },
        required: ["recipientAddress", "arbiterAddress", "maxAmount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "release_escrow",
      description: "As the Arbiter, release the locked funds in the escrow contract to the recipient.",
      parameters: {
        type: "object",
        properties: {
          contractId: {
            type: "string",
            description: "The contract address of the deployed escrow (starts with C)"
          }
        },
        required: ["contractId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "refund_escrow",
      description: "As the Arbiter, refund the locked funds in the escrow contract back to the depositor.",
      parameters: {
        type: "object",
        properties: {
          contractId: {
            type: "string",
            description: "The contract address of the deployed escrow (starts with C)"
          }
        },
        required: ["contractId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deploy_custom_contract",
      description: "Deploy a Soroban smart contract on Stellar. For token/coin deployments use contractType='token'. For NFT collections use contractType='nft'. The system uses proven hardcoded templates for these types.",
      parameters: {
        type: "object",
        properties: {
          contractType: {
            type: "string",
            enum: ["token", "nft", "coin"],
            description: "The type of contract to deploy: 'token' or 'coin' for a fungible token, 'nft' for an NFT collection."
          },
          name: {
            type: "string",
            description: "The full name of the token or NFT collection (e.g. 'Stellar App Token')"
          },
          symbol: {
            type: "string",
            description: "The ticker symbol, max 9 chars (e.g. 'STLP', 'SHIJ')"
          },
          initialSupply: {
            type: "string",
            description: "For token contracts: the initial total supply as a human-readable number (e.g. '1000000000' for 1 billion)"
          },
          decimals: {
            type: "string",
            description: "For token contracts: the number of decimal places (default '7' for Stellar standard)"
          },
          maxSupply: {
            type: "string",
            description: "For NFT contracts: the maximum number of NFTs that can ever be minted (e.g. '1000')"
          }
        },
        required: ["contractType", "name", "symbol"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "register_username",
      description: "Register a unique human-readable federated username (e.g. 'alice') for the user's phone number and wallet.",
      parameters: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "The lowercase alphanumeric username to register (e.g. 'alice', 'bob', 3-15 chars, no spaces)."
          }
        },
        required: ["username"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deploy_privacy_pool",
      description: "Deploy a new instance of the ZK-Shielded USDC Privacy Pool contract on-chain."
    }
  },
  {
    type: "function",
    function: {
      name: "deposit_private_pool",
      description: "Deposit USDC into the Privacy Pool privately by submitting a generated commitment hash.",
      parameters: {
        type: "object",
        properties: {
          contractId: {
            type: "string",
            description: "The contract address of the Privacy Pool (e.g. 'CBXYZ...')"
          },
          amount: {
            type: "string",
            description: "The amount of USDC to shield/deposit (e.g. '10.0')"
          }
        },
        required: ["contractId", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "withdraw_private_pool",
      description: "Withdraw USDC from the Privacy Pool by providing the client secret note.",
      parameters: {
        type: "object",
        properties: {
          secretNote: {
            type: "string",
            description: "The full secret note string parsed from the deposit (starts with 'stellapp-note-v1_...')"
          }
        },
        required: ["secretNote"]
      }
    }
  }
];
