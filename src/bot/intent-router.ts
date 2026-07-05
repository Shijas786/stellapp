import * as stellar from "../services/stellar";
import { decrypt } from "../services/encryption";
import { prisma } from "../services/db";
import { config } from "../services/config";
import { sendNotification } from "../agent/tools";

/**
 * Intent categories — determines routing without AI involvement.
 * HANDLED  → execute locally, never call GPT
 * COMPLEX  → always route to GPT (contracts, ZK, debug, NL reasoning)
 * UNKNOWN  → route to GPT for classification + execution
 */
export type IntentCategory = "HANDLED" | "COMPLEX" | "UNKNOWN";

export interface RouterResult {
  category: IntentCategory;
  response?: string; // set when category === "HANDLED"
}

// ─────────────────────────────────────────────
// Pattern banks
// ─────────────────────────────────────────────

const BALANCE_PATTERNS = [
  /\b(balance|balances|funds?|holdings?|portfolio|how much (do i have|xlm|usdc))\b/i,
  /\b(check|show|view|see|what('?s| is)) (my )?(balance|funds?|wallet|account|xlm|usdc)\b/i,
  /\b(how much|got|have) (xlm|usdc|tokens?|crypto)\b/i,
];

const ADDRESS_PATTERNS = [
  /\b(my (wallet |stellar |public )?(address|key|public key|account))\b/i,
  /\b(what('?s| is) my (address|wallet|key))\b/i,
  /\b(show|get|give|tell me) (me )?(my )?(address|wallet address|public key)\b/i,
];

const HISTORY_PATTERNS = [
  /\b(transaction|tx) (history|list|log|record)\b/i,
  /\b(recent|last|past) (transactions?|payments?|transfers?|txs?)\b/i,
  /\b(show|view|list|check) (my )?(transactions?|payments?|history)\b/i,
];

const HELP_PATTERNS = [
  /^(help|\/help|hi|hello|hey|start|what can you do|commands?|menu|options?)\.?$/i,
  /\b(what (can|do) (you|this bot) (do|help|support))\b/i,
  /\b(features?|capabilities|how (does|do) (this|you) work)\b/i,
];

// These require contract generation, ZK proofs, or complex multi-step reasoning — always GPT
const COMPLEX_PATTERNS = [
  /\b(deploy|write|create|build|compile|audit|generate|code|program)\b.*\b(contract|smart contract|soroban|wasm)\b/i,
  /\b(escrow|vesting|timelock|crowdfund|nft|token contract|dao)\b/i,
  /\b(confidential|private|zk|zero.?knowledge|privacy pool|proof|proving)\b/i,
  /\b(bridge|cctp|cross.?chain)\b/i,
  /\b(explain|understand|what is|how does|why|debug|error|failed)\b.*\b(contract|soroban|stellar sdk|transaction)\b/i,
  /\b(swap|exchange|trade)\b.*\b(to|for)\b/i, // swap needs DEX path + slippage reasoning
];

const RESOURCE_PATTERNS = [
  /^(resource|resources|docs|documentation|reference|primitives)$/i,
  /\b(stellar (resources|docs|reference|primitives))\b/i,
  /\b(zk (docs|resources|primitives))\b/i,
  /\b(developer (resources|docs|reference|links))\b/i,
  /\b(show|get|list) (resources|docs|links)\b/i,
];

const RESOURCE_TEXT = `🌌 *Stellar ZK & Privacy Developer Resources*

New to ZK on Stellar? Start with the official docs, then use our ZK/Privacy skills.

🚀 *Start Here: ZK & Privacy*
• ZK Proofs on Stellar (docs): https://developers.stellar.org/docs/build/apps/zk
  Explanations of BN254 and Poseidon/Poseidon2 host functions, verification details, and circuit tooling.
• Privacy on Stellar (docs): https://developers.stellar.org/docs/build/apps/privacy
  Overview of Privacy Pools, Confidential Tokens, and cryptographic primitives.
• Announcing Stellar X-Ray (Protocol 25): https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25
• Yardstick (Protocol 26) upgrade guide: https://stellar.org/blog/foundation-news/stellar-yardstick-protocol-26-upgrade-guide

🤖 *AI Development Assistance*
• Stellar Skills: https://skills.stellar.org/
  Dedicated agent-readable documentation for Soroban, dApps/wallets, ZK, etc.
• ZK Proofs skill: https://skills.stellar.org/skills/zk-proofs/SKILL.md
• Stellar Dev Skill (repo): https://github.com/stellar/stellar-dev-skill
• stellar-build (42 skills & DevRel agents): https://github.com/kaankacar/stellar-build
• OpenZeppelin Skills (secure contract development): https://github.com/OpenZeppelin/openzeppelin-skills
• Building with AI (docs): https://developers.stellar.org/docs/build/building-with-ai
• llms.txt (digest for LLM feeds): https://developers.stellar.org/llms.txt

🧬 *On-Chain ZK Verifiers (Reference Code)*
• RISC Zero (Groth16) verifier: https://github.com/NethermindEth/stellar-risc0-verifier
  Verifies proofs created with RISC Zero zkVM (Rust). Companion: https://stellar.org/blog/developers/risc-zero-verifier
• UltraHonk verifier (Noir / Barretenberg):
  - https://github.com/yugocabrio/rs-soroban-ultrahonk
  - https://github.com/indextree/ultrahonk_soroban_contract
• Stellar Private Payments (Privacy Pools PoC): https://github.com/NethermindEth/stellar-private-payments
  Circom circuits, Groth16 proofs, and Stellar smart contracts. Companion docs: https://nethermindeth.github.io/stellar-private-payments/

🛠️ *ZK Circuit Tooling*
• Noir (Aztec): https://noir-lang.org/docs/
  Friendly Rust-like DSL for writing ZK circuits.
• RISC Zero (zkVM): https://dev.risczero.com/
• Soroban SDK — BN254 docs: https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_bn254/index.html
• Soroban SDK — Poseidon docs: https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_poseidon/index.html
• Protocol CAPs: BN254 (CAP-0074) · Poseidon (CAP-0075) · BLS12-381 (CAP-0059)
• Soroban P25 preview examples: https://github.com/jayz22/soroban-examples/tree/p25-preview/p25-preview

💡 *Further Privacy Context*
• Confidential Token Association: https://www.confidentialtoken.org/
  Open standard for encryption-based on-chain confidentiality. Demo: https://www.youtube.com/watch?v=6NnDqVQYOHM
• Privacy Pools whitepaper: https://privacypools.com/whitepaper.pdf

🔧 *Core Stellar Dev Tools*
• Stellar Docs: https://developers.stellar.org/
• SDKs: https://developers.stellar.org/docs/tools/sdks
• Stellar CLI: https://developers.stellar.org/docs/tools/cli
• Stellar Lab: https://developers.stellar.org/docs/tools/lab
• Stellar Quickstart: https://developers.stellar.org/docs/tools/quickstart
• Scaffold Stellar: https://scaffoldstellar.org
• Stellar Wallets Kit: https://stellarwalletskit.dev/
• OpenZeppelin on Stellar: https://www.openzeppelin.com/networks/stellar

🧱 *Smart Contract Building Blocks*
• Smart Contracts — Getting Started: https://developers.stellar.org/docs/build/smart-contracts/getting-started
• Contract Authorization: https://developers.stellar.org/docs/build/guides/auth
• Contract Storage: https://developers.stellar.org/docs/build/guides/storage
• Contract Testing: https://developers.stellar.org/docs/build/guides/testing

👥 *Community Resources*
• Stellar Ecosystem Resources: https://github.com/stellar/ecosystem-resources/
• Stellar Hackathon FAQ: https://github.com/briwylde08/stellar-hackathon-faq
• Stellar Ecosystem DB: https://github.com/lumenloop/stellar-ecosystem-db`;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

const HELP_TEXT = `🤖 *Stellapp — What can I do?*

💸 *Payments*
• "Send 10 USDC to Alice"
• "Check my balance"
• "Show transaction history"

📍 *Wallet*
• "What's my wallet address"
• "Create wallet" (if you haven't yet)

🔄 *Swaps & Bridge*
• "Swap 5 XLM to USDC"
• "Bridge 10 USDC to Stellar"

📜 *Smart Contracts*
• "Deploy an escrow contract"
• "Build a vesting vault"

🔒 *ZK Privacy*
• "Register for confidential transfers"
• "Send 5 USDC privately"

🎤 *Voice* — just send a voice note!

_I understand natural language — just chat normally._`;

// ─────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────

// Helper to manage session state pending actions locally
async function getLocalPendingAction(chatId: string): Promise<any | null> {
  try {
    const record = await prisma.sessionState.findUnique({ where: { chatId } });
    if (record) {
      const state = JSON.parse(record.stateJson);
      if (state._pending_action) {
        const pending = JSON.parse(state._pending_action);
        if (Date.now() - pending.createdAt < 5 * 60 * 1000) {
          return pending;
        }
      }
    }
  } catch {}
  return null;
}

async function saveLocalPendingAction(chatId: string, actionName: string, args: any): Promise<void> {
  try {
    const record = await prisma.sessionState.findUnique({ where: { chatId } });
    let state = record ? JSON.parse(record.stateJson) : {};
    state._pending_action = JSON.stringify({
      name: actionName,
      args,
      createdAt: Date.now()
    });
    await prisma.sessionState.upsert({
      where: { chatId },
      create: { chatId, stateJson: JSON.stringify(state) },
      update: { stateJson: JSON.stringify(state) }
    });
  } catch {}
}

async function clearLocalPendingAction(chatId: string): Promise<void> {
  try {
    const record = await prisma.sessionState.findUnique({ where: { chatId } });
    if (record) {
      let state = JSON.parse(record.stateJson);
      delete state._pending_action;
      await prisma.sessionState.update({
        where: { chatId },
        data: { stateJson: JSON.stringify(state) }
      });
    }
  } catch {}
}

async function resolveRecipientAddress(ownerId: string, recipient: string): Promise<string> {
  let target = recipient.trim().replace(/^@/, "");
  if (target.startsWith("G") || target.startsWith("C")) {
    return target;
  }

  // 1. Check custom username
  let targetUsername = target.toLowerCase();
  if (targetUsername.includes("*")) {
    targetUsername = targetUsername.split("*")[0];
  }
  const registeredUser = await prisma.user.findFirst({
    where: { username: targetUsername }
  });
  if (registeredUser) {
    return registeredUser.stellarPublic;
  }

  // 2. Check contacts table
  const contact = await prisma.contact.findFirst({
    where: {
      ownerId,
      name: { equals: target.toLowerCase() }
    }
  });

  let phone = "";
  if (contact) {
    phone = contact.phoneNumber;
  } else {
    // Fuzzy fallback
    const allContacts = await prisma.contact.findMany({ where: { ownerId } });
    const matched = allContacts.find(c => 
      c.name.includes(target.toLowerCase()) || 
      target.toLowerCase().includes(c.name)
    );
    if (matched) {
      phone = matched.phoneNumber;
    }
  }

  if (phone) {
    const cleanedPhone = phone.replace(/[\s\-+]/g, "");
    const resolvedUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phoneNumber: cleanedPhone },
          { chatId: { endsWith: `${cleanedPhone}@c.us` } }
        ]
      }
    });
    if (resolvedUser && resolvedUser.onboarded) {
      return resolvedUser.stellarPublic;
    }
  }

  // 3. Direct phone matching
  const cleanedRecipient = target.replace(/[\s\-+]/g, "");
  if (/^[0-9]{10,18}$/.test(cleanedRecipient)) {
    const resolvedUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phoneNumber: cleanedRecipient },
          { chatId: { endsWith: `${cleanedRecipient}@c.us` } }
        ]
      }
    });
    if (resolvedUser && resolvedUser.onboarded) {
      return resolvedUser.stellarPublic;
    }
  }

  throw new Error(`Contact or Address "${recipient}" not found.`);
}

function parseMenuChoice(lastMessageContent: string, digit: number): string | null {
  const lines = lastMessageContent.split("\n");
  
  // Try to find a line starting with the digit or emoji digit
  // E.g., "1. option", "1) option", "1️⃣ option", "1 option", "[1] option", "*1* option"
  const patterns = [
    new RegExp(`^(?:${digit}️⃣|${digit}\\.|${digit}\\)|\\*${digit}\\*|\\[${digit}\\])\\s+(.+)`, "i"),
    new RegExp(`^${digit}\\s+(.+)`, "i") // fallback for "1 option"
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
  }

  return null;
}

function cleanOptionText(text: string): string {
  return text
    .replace(/^[*_~`]+|[*_~`]+$/g, "") // strip markdown wrappers
    .trim();
}

// ─────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────

/** Public entry point — always starts at depth 0 */
export async function routeIntent(
  text: string,
  user: { id: string; stellarPublic: string; stellarSecret: string; username?: string | null; chatId: string }
): Promise<RouterResult> {
  return routeIntentInternal(text, user, 0);
}

/** Internal recursive router — depth guard prevents infinite digit-resolution loops */
async function routeIntentInternal(
  text: string,
  user: { id: string; stellarPublic: string; stellarSecret: string; username?: string | null; chatId: string },
  depth: number
): Promise<RouterResult> {
  const t = text.trim();

  // 0. Handle single digit menu selections (max 1 level deep)
  if (/^[1-9]$/.test(t) && depth === 0) {
    try {
      const record = await prisma.chatHistory.findUnique({ where: { chatId: user.chatId } });
      if (record) {
        const history = JSON.parse(record.messages);
        const lastAssistant = [...history].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant && typeof lastAssistant.content === "string") {
          const digit = parseInt(t, 10);
          const optionText = parseMenuChoice(lastAssistant.content, digit);
          if (optionText) {
            const cleaned = cleanOptionText(optionText);
            console.log(`[Intent Router] Resolved digit "${t}" to menu option: "${cleaned}"`);
            
            // Only resolve one level deep to prevent infinite recursion
            if (cleaned !== t) {
              return routeIntentInternal(cleaned, user, depth + 1);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Intent Router] Error parsing digit choice:", err);
    }
  }

  // 1. Fast-exit: clearly complex → always GPT
  if (matchesAny(t, COMPLEX_PATTERNS)) {
    return { category: "COMPLEX" };
  }

  // 2. Help / menu
  if (matchesAny(t, HELP_PATTERNS)) {
    return { category: "HANDLED", response: HELP_TEXT };
  }

  // 2b. Resources / links / documentation
  if (matchesAny(t, RESOURCE_PATTERNS)) {
    return { category: "HANDLED", response: RESOURCE_TEXT };
  }

  // 3. Check for pending action confirmation first
  const pending = await getLocalPendingAction(user.chatId);
  const confirmationTerms = [
    "yes", "confirm", "confrim", "confrm", "y", "go ahead", "approve", 
    "ok", "okay", "do it", "yep", "yeah", "yea", "agree", "sure", 
    "send", "proceed"
  ];
  const isConfirm = confirmationTerms.some(term => t.toLowerCase() === term || t.toLowerCase() === `${term}.`);

  if (pending && isConfirm) {
    if (pending.name === "send_stellar") {
      try {
        const { recipient, resolvedAddr, amount, asset } = pending.args;
        const stellarSecret = decrypt(user.stellarSecret);
        const isUSDC = asset === "USDC";

        // Check activation and fund if needed (Testnet only)
        const isActivated = await stellar.isAccountActivated(resolvedAddr);
        if (!isActivated && !config.isMainnet) {
          const resolvedUser = await prisma.user.findFirst({
            where: { stellarPublic: resolvedAddr }
          });
          if (resolvedUser) {
            await stellar.fundStellarAccount(resolvedAddr);
            await stellar.ensureUSDCTrustline(decrypt(resolvedUser.stellarSecret));
          }
        }

        // Standard send
        const txHash = await stellar.sendStellarToken(
          stellarSecret,
          resolvedAddr,
          amount,
          isUSDC
        );

        await clearLocalPendingAction(user.chatId);

        // Notify recipient if they are a registered Stellapp user
        try {
          const recipientUser = await prisma.user.findFirst({
            where: { stellarPublic: resolvedAddr }
          });
          if (recipientUser && recipientUser.chatId !== user.chatId) {
            const senderBalances = await stellar.getBalances(recipientUser.stellarPublic).catch(() => null);
            const balanceText = senderBalances
              ? `\n\n💰 *New Balances:*\n• XLM: ${senderBalances.xlm}\n• USDC: ${senderBalances.usdc}`
              : "";
            const explorerUrl = `${config.explorerUrlStellar}${txHash}`;
            await sendNotification(
              recipientUser.chatId,
              `📩 *Payment Received!* 💸\n\nYou received *${amount} ${asset}* from *${recipient || "a Stellapp user"}*.${balanceText}\n\n🔗 ${explorerUrl}`
            );
          }
        } catch (notifErr: any) {
          console.error("[Router] Failed to notify send_stellar recipient:", notifErr.message);
        }

        return {
          category: "HANDLED",
          response: `✅ *Transaction Successful!* 📤\n\n` +
            `Sent *${amount} ${asset}* to *${recipient}*.\n` +
            `Address: \`${resolvedAddr}\`\n\n` +
            `Tx Hash: \`${txHash.slice(0, 8)}...\`\n` +
            `Explorer: ${config.explorerUrlStellar}${txHash}`
        };
      } catch (err: any) {
        await clearLocalPendingAction(user.chatId);
        return {
          category: "HANDLED",
          response: `❌ *Transaction Failed:* ${err.message || err}`
        };
      }
    }
  }

  // If there was a pending action but the user replied with something else, discard the pending action
  if (pending && !isConfirm) {
    await clearLocalPendingAction(user.chatId);
  }

  // 4. Regex parsing for SEND command: "Send 10 XLM to Alice"
  const sendRegex = /^(?:send|transfer|pay)\s+(\d+(?:\.\d+)?)\s*(xlm|usdc)\s+to\s+([a-zA-Z0-9_\-\+\*\s\.]+)(?:\.?)$/i;
  const sendMatch = t.match(sendRegex);
  if (sendMatch) {
    try {
      const amount = sendMatch[1];
      const asset = sendMatch[2].toUpperCase();
      const recipient = sendMatch[3].trim();

      // Resolve recipient address
      const resolvedAddr = await resolveRecipientAddress(user.id, recipient);

      // Save pending action
      await saveLocalPendingAction(user.chatId, "send_stellar", {
        recipient,
        resolvedAddr,
        amount,
        asset
      });

      return {
        category: "HANDLED",
        response: `💱 *Send Confirmation*\n\n` +
          `You want to send *${amount} ${asset}* to *${recipient}*.\n` +
          `Address: \`${resolvedAddr.slice(0, 6)}...${resolvedAddr.slice(-6)}\`\n\n` +
          `Reply with *Confirm* to proceed.`
      };
    } catch (err: any) {
      return {
        category: "HANDLED",
        response: `⚠️ *Recipient Resolution Failed:*\n${err.message || err}\n\nMake sure they are registered on Stellapp or use a direct Stellar address.`
      };
    }
  }

  // 5. Let AI agent handle balance check, wallet address, and transaction history conversationally

  // 8. All other intents → GPT
  return { category: "UNKNOWN" };
}

