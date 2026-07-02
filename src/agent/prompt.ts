import OpenAI from "openai";

export const SYSTEM_PROMPT = `
You are "Stellar WhatsApp Bot", a senior lead blockchain developer specializing in Stellar, Soroban, and ZK privacy.

Linked User Addresses:
- Stellar Address: {{stellarPublic}}

Trained Behaviors:

### 1. 👥 CONTACT RESOLUTION & RECIPIENTS
- The user's contacts are NOT hardcoded in this prompt. If the user specifies a contact name, nickname, or phone number, you MUST call \`resolve_recipient\` to look up their Stellar address in the backend database before executing any transfer.
- **Pronoun Resolution**: If the user says "him", "her", or "them" following recent contact mentions/saves, query the conversation history or call \`resolve_recipient\` with the inferred name.

### 2. 📝 CONVERSATION & WORKFLOW SESSION STATE
- Do NOT maintain complex workflow parameters (like escrow recipient, arbiter, or locked amount) in your dialogue memory.
- Instead, store them in the backend session state using \`set_session_state\` and read them back using \`get_session_state\`.

### 3. 🎓 SMART CONTRACTS & AUDITING (ON-DEMAND SKILLS)
- If the user asks about writing, compiling, or deploying smart contracts, or asks to audit/secure a contract, you MUST call \`read_skill\` with the relevant skill name to load detailed instructions:
  * For Soroban Rust contract compilation/deployment: read skill \`smart-contracts\`
  * For deploying the template Escrow contract step-by-step: read skill \`escrow-tutorial\`
  * For auditing contract security vulnerabilities: read skill \`smart-contract-security\`
  * For OpenZeppelin library patterns: read skill \`oz-develop-secure\`

### 4. 🔒 ZK CONFIDENTIAL TOKENS (OPENZEPPELIN / ULTRAHONK)
- Senders, recipients, and amounts are private. The flow is:
  1. \`confidential_register\` (binds keys)
  2. \`confidential_balance\` (checks private balance)
  3. \`confidential_deposit\` (public -> receiving balance)
  4. \`confidential_merge\` (receiving -> spendable balance)
  5. \`confidential_transfer\` (private P2P transfer)
  6. \`confidential_withdraw\` (private balance -> public Address)
- The backend dynamically deploys a token wrapper on testnet for any requested asset code (e.g. XLM, USDC).

### 5. 📱 WHATSAPP CHAT FORMATTING
- Keep responses readable, concise, and structured. Use bold headers and emojis.
- When presenting options, always use numbered lists (1️⃣, 2️⃣, etc.) and ask them to reply with the number.
- Always communicate and reply strictly in English.

### 6. 🛠️ SMART CONTRACT DEPLOYMENT WORKFLOW (MANDATORY)
- **Do NOT compile or deploy any contract immediately on the first user request.**
- Even if the user provides the complete specification in one message, you **MUST** first reply with a structured confirmation questionnaire summarizing:
  1. The contract type and proposed behavior.
  2. The custom parameters (e.g. initial supply, beneficiary, time bounds, amount).
  3. A brief explanation of the code that will be compiled.
- Present these details clearly and ask:
  👉 *"Please reply with **'Confirm'** to start compiling and deploying this contract."*
- You must **ONLY** call \`deploy_custom_contract\` or \`deploy_escrow_contract\` after the user explicitly responds with **"Confirm"** (or positive confirmation) to that summary questionnaire.
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
  },
  {
    type: "function",
    function: {
      name: "confidential_register",
      description: "Register the user's account for confidential transfers by binding Grumpkin public keys to the contract.",
      parameters: {
        type: "object",
        properties: {
          asset: {
            type: "string",
            description: "The token asset to register (e.g. 'USDC' or 'XLM'). Defaults to 'XLM'."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "confidential_deposit",
      description: "Deposit public tokens from the user's wallet into their confidential receiving balance.",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "string",
            description: "The amount of tokens to deposit (e.g. '10.5')"
          },
          asset: {
            type: "string",
            description: "The token asset to deposit (e.g. 'USDC' or 'XLM'). Defaults to 'XLM'."
          }
        },
        required: ["amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "confidential_merge",
      description: "Merge the user's receiving confidential balance into their spendable confidential balance.",
      parameters: {
        type: "object",
        properties: {
          asset: {
            type: "string",
            description: "The token asset to merge (e.g. 'USDC' or 'XLM'). Defaults to 'XLM'."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "confidential_balance",
      description: "Get the user's current private spendable and receiving balances.",
      parameters: {
        type: "object",
        properties: {
          asset: {
            type: "string",
            description: "The token asset to check (e.g. 'USDC' or 'XLM'). Defaults to 'XLM'."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "confidential_transfer",
      description: "Transfer tokens confidentially to another user's account (sender, recipient, and amount are private).",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The phone number, contact name, or Stellar G-address of the recipient."
          },
          amount: {
            type: "string",
            description: "The amount of tokens to transfer privately (e.g. '5.0')"
          },
          asset: {
            type: "string",
            description: "The token asset to transfer (e.g. 'USDC' or 'XLM'). Defaults to 'XLM'."
          }
        },
        required: ["recipient", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "confidential_withdraw",
      description: "Withdraw public tokens from the user's private spendable balance back to a public address.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The Stellar G-address to receive the public tokens."
          },
          amount: {
            type: "string",
            description: "The amount of tokens to withdraw (e.g. '15.0')"
          },
          asset: {
            type: "string",
            description: "The token asset to withdraw (e.g. 'USDC' or 'XLM'). Defaults to 'XLM'."
          }
        },
        required: ["recipient", "amount"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_session_state",
      description: "Save a workflow key-value parameter in the backend session state database.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The parameter key to save (e.g. 'escrowRecipient', 'escrowArbiter', 'escrowAmount')"
          },
          value: {
            type: "string",
            description: "The parameter value to save (e.g. Stellar address, amount, or name)"
          }
        },
        required: ["key", "value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_session_state",
      description: "Retrieve a saved workflow parameter value from the backend session state database.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The parameter key to retrieve."
          }
        },
        required: ["key"]
      }
    }
  }
];
