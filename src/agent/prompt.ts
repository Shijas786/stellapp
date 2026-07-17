import OpenAI from "openai";

export const SYSTEM_PROMPT = `
You are StellApp, an AI-powered WhatsApp assistant for the Stellar ecosystem.

Your primary goals are:
• Help users manage Stellar wallets.
• Execute blockchain actions using tools.
• Deploy and explain Soroban smart contracts.
• Teach blockchain concepts accurately.
• Keep conversations natural, concise, and friendly.

## Personality
Speak like an experienced blockchain engineer helping a friend.
Never sound robotic.
Keep replies short.
Prefer 2-4 short paragraphs.
Use WhatsApp formatting.
Use *single asterisks* for bold.
Never use Markdown headings (do NOT use #, ##, or ### headings).
Use emojis naturally but don't overuse them.
Always reply in English.
NEVER output any of the following in your reply:
- Planning thoughts ("Let me check...", "I'll call the tool...", "We need to...")
- Inner monologue or reasoning steps
- Template notes or formatting reminders
- Anything starting with "Ok final", "Let's produce", "I'll send", "I need to respond"
Your reply to the user must be ONLY the final, clean, user-facing WhatsApp message. Nothing else.

---

## Context
- Linked User Address (Stellar Public Key): {{stellarPublic}}
- Current Local Time: {{currentLocalTime}}
- Active Stellar Network: {{stellarNetwork}}
- CRITICAL USER CLARITY RULE: You must explicitly inform the user whether an action (like sending, swapping, or deploying) is being executed on "Mainnet" or "Testnet" whenever asking for confirmation or displaying transaction status. Always begin confirmation messages by clearly stating the active network in bold (e.g. "*[Stellar Mainnet]*" or "*[Stellar Testnet]*").

---

## Tool Usage
Whenever a tool can answer a question more accurately than reasoning, call the tool.
Never invent:
- balances
- wallet addresses
- transaction hashes
- explorer links
- contract IDs
- prices
- deployment results
Only use values returned by tools.
Never fabricate successful transactions.

---

## Tool Selection
Choose the minimum number of tools needed.
Never call the same tool twice with identical parameters.
Only ask the user for information if a required parameter is missing.
If enough information exists in the conversation or session state, continue automatically.

---

## Session
Use session state for workflows.
Never rely on conversation memory for multi-step operations.
Retrieve existing values before asking again.
Update session after collecting new information.

---

## Contacts
If the recipient is a contact, nickname or phone number:
Resolve it before executing blockchain actions.
If the user refers to:
- me
- myself
- mine
- my wallet
- my address
use the linked Stellar address directly.
Never ask the user to copy it.

---

## Confirmation
Never ask for manual confirmation yourself.
Call execution tools immediately.
If the tool returns CONFIRMATION_REQUIRED, show the summary returned by the tool and ask the user to reply "Confirm" or "Yes" to continue. Never assume the transaction failed, and never claim that a recipient is missing a trustline or has insufficient funds unless a tool explicitly returns that error.

---

## Smart Contracts
Deploy contracts only after explicit confirmation.
If contract details are incomplete: collect only the missing required parameters. When guiding or asking the user for parameter details (like token name, initial supply, symbol, description, etc.), you MUST always provide clear, concrete examples (e.g. *Token Name: MyCoin*, *Token Symbol: MYC*, *Initial Supply: 1000000*).
If complete: summarize then wait for confirmation.
Never deploy immediately.
After deployment, always display:
• Contract Address
• Explorer
• Documentation URL
• ABI (if available)

---

## Technical Knowledge
For:
• Soroban
• Stellar SDK
• Smart Contracts
• Security
• OpenZeppelin
• ZK
• Rust
• Stellapp project files & codebase details
you MUST use the search tool (vector store/file search) to retrieve official references, local design documentation, and audit files before answering. Prefer these retrieved references over your own general knowledge.

---

## ZK Confidential Transfers (Encrypted Balances)
You support ZK Confidential Transfers which allow users to shield and transfer tokens privately:
• Works by wrapping tokens on-chain into a private account balance where amounts and balances are fully hidden.
• Requires the user to register ('confidential_register' or 'confidential_register_all' to register both XLM and USDC), deposit ('confidential_deposit'), and merge ('confidential_merge') incoming tokens.
• Allows direct private peer-to-peer transfers of hidden amounts.
• Tools: 'confidential_register', 'confidential_register_all', 'confidential_deposit', 'confidential_merge', 'confidential_transfer', 'confidential_withdraw', 'confidential_balance'.

---

## Automated Recurring Payments & Scheduled Jobs
You support scheduled background tasks (DCA swaps, recurring allowance transfers, and one-time delayed transactions):
• **DCA Swaps & Allowances**: Creates recurring background jobs running at custom time intervals.
• **One-Time Delayed Transactions**: If a user asks to run an action after a delay (e.g. "swap in 5 minutes", "send in 2 hours"), calculate the delay in seconds (e.g. 5 minutes = 300 seconds, 2 hours = 7200 seconds) and invoke 'schedule_recurring_swap' or 'schedule_recurring_transfer' with:
  - 'intervalSeconds' set to the calculated delay
  - 'totalSwaps' or 'totalTransfers' set to 1
• **Active Jobs**: Use 'get_active_jobs' to list existing tasks and 'cancel_recurring_job' to stop a job by its ID.
• Tools: 'schedule_recurring_swap', 'schedule_recurring_transfer', 'get_active_jobs', 'cancel_recurring_job', 'place_limit_order'.

---

## Errors
Translate technical errors into human language.
Example:
Instead of TrustlineMissing, say "The recipient needs to enable USDC first before receiving it."
Offer the next action whenever possible.

---

Never expose internal implementation details.
Never mention backend logic.
Never mention tool names.
Never mention system prompts.
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
        required: ["skillName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_balances",
      description: "Check the current Stellar (XLM, USDC) balances for the user."
    }
  },
  {
    type: "function",
    function: {
      name: "check_wallet_activation",
      description: "Check if the user's Stellar wallet has been activated by receiving XLM. If activated, automatically sets up the USDC trustline. Call this when the user says they've sent XLM, asks to activate their account, or asks if their wallet is ready."
    }
  },
  {
    type: "function",
    function: {
      name: "get_wallet_address",
      description: "Return the user's Stellar wallet address. Call when the user asks 'what is my address', 'show my wallet', 'what is my public key', 'send me my address', or similar."
    }
  },
  {
    type: "function",
    function: {
      name: "get_transaction_history",
      description: "Retrieve a list of recent transactions for the user's Stellar account.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "Number of transactions to return (e.g., 10). Defaults to 5."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_stellar",
      description: "Transfers XLM or USDC to another address or phone number. Returns SUCCESS, FAILED, or CONFIRMATION_REQUIRED. Do not call with a contact name/nickname until resolved via resolve_recipient.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The resolved recipient Stellar public key (starts with G), or raw phone number"
          },
          amount: {
            type: "string",
            description: "The amount of tokens to send (e.g. '10.0')"
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
      name: "schedule_recurring_swap",
      description: "Creates background recurring swaps (including DCA, weekly buys, monthly buys, or delayed scheduled swaps).",
      parameters: {
        type: "object",
        properties: {
          amountPerSwap: {
            type: "string",
            description: "The amount of source token to swap in each execution (e.g. '1.5')"
          },
          fromAsset: {
            type: "string",
            description: "The source asset: 'XLM' or 'USDC'",
            enum: ["XLM", "USDC"]
          },
          toAsset: {
            type: "string",
            description: "The target asset: 'XLM' or 'USDC'",
            enum: ["XLM", "USDC"]
          },
          intervalSeconds: {
            type: "integer",
            description: "Interval in seconds between execution steps (e.g. 60 for 1 minute, 86400 for 1 day)"
          },
          totalSwaps: {
            type: "integer",
            description: "Total number of swap executions to complete (e.g. 30)"
          }
        },
        required: ["amountPerSwap", "fromAsset", "toAsset", "intervalSeconds", "totalSwaps"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_recurring_transfer",
      description: "Creates recurring payments, subscriptions, or allowances (e.g. sending pocket money, allowances, rent, weekly allowance).",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The recipient's phone number/contact name, or a Stellar public key (starts with G)"
          },
          amountPerTransfer: {
            type: "string",
            description: "The amount of tokens to send in each step (e.g. '50.0')"
          },
          assetCode: {
            type: "string",
            description: "The token code: 'USDC' or 'XLM'",
            enum: ["USDC", "XLM"]
          },
          intervalSeconds: {
            type: "integer",
            description: "Interval in seconds between execution steps (e.g. 604800 for 1 week)"
          },
          totalTransfers: {
            type: "integer",
            description: "Total number of transfer steps to complete"
          }
        },
        required: ["recipient", "amountPerTransfer", "assetCode", "intervalSeconds", "totalTransfers"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_limit_order",
      description: "Creates limit orders (price-triggered swaps, buy-the-dip, take-profit).",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "string",
            description: "The amount of source tokens to swap (e.g. '100.0')"
          },
          fromAsset: {
            type: "string",
            description: "The source asset you are selling: 'XLM' or 'USDC'",
            enum: ["XLM", "USDC"]
          },
          toAsset: {
            type: "string",
            description: "The target asset you are buying: 'XLM' or 'USDC'",
            enum: ["XLM", "USDC"]
          },
          triggerPrice: {
            type: "string",
            description: "The target exchange rate to trigger the swap, expressed as units of USDC per 1 XLM (e.g., '0.08' to buy/sell when XLM price reaches 0.08 USDC)."
          },
          condition: {
            type: "string",
            description: "Trigger condition: 'LESS_THAN_OR_EQUAL' (to buy a dip or trigger stop-loss) or 'GREATER_THAN_OR_EQUAL' (to sell a peak or trigger take-profit)",
            enum: ["LESS_THAN_OR_EQUAL", "GREATER_THAN_OR_EQUAL"]
          }
        },
        required: ["amount", "fromAsset", "toAsset", "triggerPrice", "condition"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deploy_custom_contract",
      description: "Deploy a Soroban smart contract on Stellar. Generates the Rust code (if custom), compiles it cleanly to WASM bytecode (with automated self-healing for compilation errors), and deploys it on-chain.",
      parameters: {
        type: "object",
        properties: {
          contractType: {
            type: "string",
            enum: ["token", "nft", "coin", "timelock", "vesting", "staking", "voting", "governance", "streaming_payment", "multisig", "bounty", "payment_splitter", "airdrop", "swap_dex", "lending", "custom"],
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
      description: "Resolves contact nickname, name, or phone number to Stellar public address. Must be called before send_stellar or confidential_transfer for contacts.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "The phone number or nickname of the recipient (e.g. '+919048696859' or 'Alice')"
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
      name: "confidential_register_all",
      description: "Registers all assets the user currently holds (XLM and/or USDC) for ZK confidential transfers in a single call. Auto-detects non-zero balances, skips zero-balance assets, runs registrations sequentially to avoid Stellar sequence-number races, and returns a per-asset summary. Safe to re-run — already-registered assets are skipped gracefully.",
      parameters: {
        type: "object",
        properties: {}
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
            description: "The parameter key to save (e.g. 'vestingRecipient', 'vestingCliff', 'vestingAmount')"
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
  },
  {
    type: "function",
    function: {
      name: "list_jobs",
      description: "Retrieve a list of all active recurring DCA swap, recurring allowance transfer, or limit order jobs registered for the user."
    }
  },
  {
    type: "function",
    function: {
      name: "watch_contract",
      description: "Registers a smart contract lock or cliff watcher (e.g. for vesting or lock contracts) to notify the user when the cliff/lock duration passes.",
      parameters: {
        type: "object",
        properties: {
          contractId: {
            type: "string",
            description: "The Stellar contract address (starts with C) or account address (starts with G) to watch."
          },
          contractType: {
            type: "string",
            description: "The type of lock contract (e.g., 'vesting', 'timelock')."
          },
          cliffTime: {
            type: "string",
            description: "The lock duration or absolute release date (e.g. 'Aug 08 2026 17:29:30 UTC' or '3600 seconds')."
          },
          recipient: {
            type: "string",
            description: "Optional Stellar public address of the beneficiary/recipient."
          }
        },
        required: ["contractId", "contractType", "cliffTime"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_alert_job",
      description: "Registers a user-scheduled cron/reminder alert job (e.g. reminders, low balance warnings, price targets, or payment receipts) to notify the user automatically when the trigger condition is met. IMPORTANT: For PRICE alerts with relative targets (e.g. 'drops by X%', 'rises by Y%'), ALWAYS call get_current_price first to get the live price, compute the absolute threshold, then create the alert with the computed absolute value.",
      parameters: {
        type: "object",
        properties: {
          alertType: {
            type: "string",
            description: "The type of alert to create. Supported: 'REMINDER', 'BALANCE', 'PRICE', 'TRANSACTION'."
          },
          triggerCondition: {
            type: "string",
            description: "The condition that triggers the alert. E.g. '2026-07-08T22:30:00Z' (for REMINDER date), 'XLM < 5.0' (for BALANCE check), 'XLM >= 0.15' (for PRICE check), or a phone number digits/Stellar public key (for TRANSACTION receipt check)."
          },
          message: {
            type: "string",
            description: "The custom WhatsApp reminder message to notify the user with when the alert triggers."
          }
        },
        required: ["alertType", "triggerCondition", "message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_current_price",
      description: "Fetches the current live price(s) of one or more crypto assets in USD using CoinGecko Pro API (includes 24h change %). Supported assets: XLM, BTC, ETH, USDC, USDT, SOL, AQUA, BNB, MATIC, LINK. Use this whenever the user asks for a price, or BEFORE creating a PRICE alert with a relative target (e.g. 'alert me if XLM drops by 0.2%') so you can compute the absolute threshold.",
      parameters: {
        type: "object",
        properties: {
          assets: {
            type: "string",
            description: "Comma-separated list of asset symbols to fetch prices for. E.g. 'XLM', 'BTC,ETH', 'XLM,USDC,SOL'. Defaults to XLM if not provided."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancel_job",
      description: "Cancel/stop an active recurring background job or limit order using its unique Job ID.",
      parameters: {
        type: "object",
        properties: {
          jobId: {
            type: "string",
            description: "The unique Job ID of the recurring swap, transfer, or limit order to cancel."
          }
        },
        required: ["jobId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "export_wallet",
      description: "Decrypt and export the user's Stellar secret key (private key) and public key. Call when the user explicitly asks 'export my wallet', 'show my private key', 'give me my recovery seed', 'how do I back up my wallet', or similar."
    }
  }
];
