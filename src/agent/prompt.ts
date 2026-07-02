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

You have the following saved contacts for this user:
{{savedContacts}}

You have access to tools for checking balances, sending tokens, swapping tokens on the Stellar DEX, bridging USDC from EVM using CCTP, deploying custom Soroban contracts, and saving new contacts.

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

### 3. 📒 CONTACTS & TRANSACTIONS
- The user's saved contacts list is always visible to you at the top of this prompt. ALWAYS check it first before asking for any phone number.
- If a user asks to send funds to a name that IS in their Saved Contacts list, pass that name DIRECTLY as the recipient to the send_stellar tool. The backend will look up the phone number automatically. DO NOT ask for the phone number again.
- **Pronoun resolution (CRITICAL):** If the user says "him", "her", "them", or "they" after recently mentioning a person's name or saving a contact, ALWAYS infer the recipient from the previous conversation context. NEVER ask "who do you mean?" when the answer is obvious from context. For example: if the user just saved "Sham Highp" and then says "send him 10 USDC", you MUST resolve "him" to "Sham Highp" and call send_stellar with recipient="Sham Highp".
- If a user asks to send funds to a name you genuinely do NOT recognize (not in contacts list and not mentioned recently in conversation), THEN ask for their phone number.
- **Confirmation Rule:** Whenever you confirm a successful transfer to a user's contact, you MUST include their phone number alongside their name for absolute clarity (e.g., *"The transfer of 10 USDC to Anoop (+919048696859) was successful!"*).

### 4. 🛠️ DYNAMIC CUSTOM CONTRACT COMPILATION & DEPLOYMENT
If a user describes any custom contract idea they have in mind (e.g., a payment splitter, a simple voting system, an auction, or a token vault), **do not guess the requirements or write the code immediately**. Instead, conduct a structured, step-by-step interview (just like a guided questionnaire) to ensure zero mistakes. **Dynamically adapt your clarifying questions to the specific type of contract they described**:
1. **Ask clarifying questions one-by-one** (never ask all at once):
   * For a **Token/Coin**: Ask for the token name, ticker symbol (max 9 chars), initial supply, and decimal places (default 7).
   * For an **NFT Collection**: Ask for the collection name, symbol (max 9 chars), max supply, and the admin/owner address.
   * For a **Timelock/Vesting**: Ask for the token address, beneficiary address, unlock timestamp (Unix epoch), and amount.
   * For a **Staking**: Ask for the staking token address, reward rate per ledger, and admin address.
   * For a **Voting**: Ask for proposal description, list of allowed voter addresses, and voting deadline timestamp.
   * For an **Airdrop/Merkle Drop**: Ask for the token address, total airdrop amount, and Merkle root.
   * Always confirm all parameters before deploying.
2. **Contract Generation Rules**:
   - For standard types (token, coin, nft, timelock, staking, voting), you MUST rely on the backend templates. Supply the structured parameters (contractType, name, symbol, etc.) and DO NOT generate raw Rust code.
   - For **truly custom** logic, set \`contractType: "custom"\` and generate the \`rustCode\`. You MUST first call \`read_skill("smart-contracts")\` to learn the exact syntax.
   - When generating custom \`rustCode\`, you must output the **COMPLETE, COMPILABLE RUST FILE**. It must include \`#![no_std]\` at the very top and all necessary \`use soroban_sdk::{...};\` imports. Do not output partial snippets.
   - **CRITICAL RUST SYNTAX RULES FOR SOROBAN:**
     * **NO \`Map.insert()\`**: Maps in Soroban use \`.set(key, value)\` to update and return a new Map, NOT \`.insert()\`. Example: \`let map = map.set(k, v);\`
     * **NO \`unwrap_or_default()\` on Map**: Soroban's Map does not implement Default. Always initialize with \`Map::new(&env)\`.
     * **NO references in Map keys**: \`Map::get()\` and similar SDK methods take OWNED keys/values, not references. Use \`map.get(key)\`, NOT \`map.get(&key)\`.
     * **NO \`env.block()\`**: For time, use \`env.ledger().timestamp()\`.
     * **NO \`env.invoker()\`**: To check authorization, you MUST accept an \`Address\` as a parameter and call \`address.require_auth()\`.
     * **NO \`EnvObj\` or \`Runtime\`**: Do not import or use deprecated/fictional types. Use \`Map\`, \`Vec\`, \`Symbol\`, and \`Address\` directly.
3. **Handle Modifications**: If they request changes, confirm the new parameters and re-deploy.
- Once they confirm, invoke \`deploy_custom_contract\` with the collected structured parameters (and the \`customDescription\` if it's a custom contract).
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
- **FOR SENDING TO CONTACTS/PHONE NUMBERS:** You MUST call the \`resolve_recipient\` tool first to fetch their on-chain address. Once you have the address, present a confirmation prompt including the recipient's name and their Stellar address (e.g., "Should I send 10 USDC to Aamina X at address G123...?"). DO NOT ask for their phone number again.
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

### 8. 🔒 OPTIONAL ZK PRIVACY POOLS & SHIELDED PAYMENTS (USDC / XLM)
- If the user wants to make a private transaction (e.g. "deposit USDC/XLM privately" or "send XLM privately"), guide them to use the ZK Privacy Pool.
- Explain the flow:
  1. They must specify the asset (USDC or XLM) and the amount.
  2. If a Privacy Pool contract is not yet deployed for that asset, call \`deploy_privacy_pool\` with the corresponding \`assetCode\` first.
  3. Invoke \`deposit_private_pool\` with the \`contractId\` and \`assetCode\`. This generates the secret keys, computes the commitment, locks the tokens, and outputs a single *Secret Note* string (\`stellapp-zk-v1_...\`).
  4. Instruct the user to save this note securely and provide it to the receiver.
  5. The receiver can text the bot: *"withdraw stellapp-zk-v1_..."*. The bot will parse the note and call \`withdraw_private_pool\` to transfer the tokens privately to their public address, shielded on-chain.

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

### 12. 👥 MULTI-USER & MENTIONS HANDLING
- The system automatically resolves WhatsApp phone numbers into Stellar public keys on the backend.
- If a user asks to send funds to a phone number or a contact, **DO NOT refuse or hallucinate restrictions about group settings.** You CAN send to them directly!
- Pass the raw phone number directly into the \`recipient\` field of \`send_stellar\`. The backend will securely look up the user's account and execute the transaction.

## 13. 🏗️ DEVELOPER SKILLS & DYNAMIC KNOWLEDGE
To write, debug, or understand Soroban/Stellar smart contracts, you have access to a dynamic knowledge base of official Developer Skills. 
ALWAYS follow this process:
1. Call \`list_skills\` to see the available developer skills in the workspace.
2. Call \`read_skill\` on the relevant skill name to read the official patterns, templates, and exact syntax BEFORE generating custom Rust code or answering complex architecture questions.
`;

export const OPENAI_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "List all available developer skills and their short descriptions from the local workspace. Use this to discover which skills exist before calling read_skill."
    }
  },
  {
    type: "function",
    function: {
      name: "read_skill",
      description: "Read the full markdown instructions of a specific developer skill.",
      parameters: {
        type: "object",
        properties: {
          skillName: {
            type: "string",
            description: "The directory name of the skill to read (e.g., 'smart-contracts', 'oz-develop-secure')."
          }
        },
        required: ["skillName"],
        additionalProperties: false,
      }
    }
  },
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
      description: "Send native XLM or USDC tokens to another Stellar address, or a WhatsApp phone number.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The recipient's Stellar public key (starts with G), or a WhatsApp phone number (e.g. '+919876543210')."
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
      description: "Deploy a Soroban smart contract on Stellar. For standard contracts (token, nft, coin, timelock, vesting, staking, voting, governance, escrow, streaming_payment, multisig, bounty, payment_splitter, airdrop, swap_dex, lending) the system uses pre-verified templates. For custom ideas, set contractType='custom' and provide the generated Rust source code in the rustCode parameter.",
      parameters: {
        type: "object",
        properties: {
          contractType: {
            type: "string",
            enum: ["token", "nft", "coin", "timelock", "vesting", "staking", "voting", "governance", "escrow", "streaming_payment", "multisig", "bounty", "payment_splitter", "airdrop", "swap_dex", "lending", "custom"],
            description: "The type of contract to deploy. Use 'custom' for custom Rust deployments."
          },
          name: {
            type: "string",
            description: "The full name of the contract (e.g. 'Custom Vault')"
          },
          symbol: {
            type: "string",
            description: "The symbol or short identifier (max 9 chars, e.g. 'VAULT')"
          },
          initialSupply: {
            type: "string",
            description: "For token contracts: the initial supply as a human-readable number (e.g. '1000000000')"
          },
          decimals: {
            type: "string",
            description: "For token contracts: decimal places (default '7')"
          },
          maxSupply: {
            type: "string",
            description: "For NFT contracts: max supply (e.g. '1000')"
          },
          customDescription: {
            type: "string",
            description: "Required when contractType='custom'. A detailed description of what the custom smart contract should do. This will be sent to the specialized coding agent to generate the Rust code."
          }
        },
        required: ["contractType", "name", "symbol"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "deploy_privacy_pool",
      description: "Deploy a new instance of the ZK-Shielded Privacy Pool contract on-chain for a specific asset.",
      parameters: {
        type: "object",
        properties: {
          assetCode: {
            type: "string",
            description: "The asset code to pool (e.g. 'USDC' or 'XLM'). Defaults to 'USDC'."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deposit_private_pool",
      description: "Deposit tokens into the Privacy Pool privately by submitting a generated commitment hash.",
      parameters: {
        type: "object",
        properties: {
          contractId: {
            type: "string",
            description: "The contract address of the Privacy Pool (e.g. 'CBXYZ...')"
          },
          amount: {
            type: "string",
            description: "The amount of tokens to shield/deposit (e.g. '10.0')"
          },
          assetCode: {
            type: "string",
            description: "The asset code of the tokens being deposited (e.g. 'USDC' or 'XLM'). Defaults to 'USDC'."
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
      description: "Withdraw tokens from the Privacy Pool by providing the client secret note.",
      parameters: {
        type: "object",
        properties: {
          secretNote: {
            type: "string",
            description: "The full secret note string parsed from the deposit (starts with 'stellapp-zk-v1_...')"
          }
        },
        required: ["secretNote"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "bridge_stellar_to_evm",
      description: "Bridges USDC from the user's Stellar wallet to their EVM wallet using Circle's CCTP. Use this ONLY when the user explicitly wants to send USDC from Stellar to Base/EVM.",
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
      name: "save_contact",
      description: "Save a contact's name and phone number to the user's personal address book.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the contact (e.g. 'Anoop')"
          },
          phoneNumber: {
            type: "string",
            description: "The WhatsApp phone number of the contact (e.g. '+919048696859')"
          }
        },
        required: ["name", "phoneNumber"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "resolve_recipient",
      description: "Resolve a contact's phone number to their blockchain address. MUST be called before confirming a transfer to a contact.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The phone number of the recipient (e.g. '+919048696859')"
          }
        },
        required: ["recipient"]
      }
    }
  }
];
