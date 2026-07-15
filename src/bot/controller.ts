import { config } from "../services/config";
import { prisma } from "../services/db";
import { encryptForUser, decryptForUserWithMigration } from "../services/encryption";
import { createStellarWallet, fundStellarAccount, ensureUSDCTrustline } from "../services/stellar";
import { runAgentLoop, appendChatRound } from "../agent/agent";
import { networkStorage } from "../services/network-context";
import path from "path";

/**
 * Main coordinator function that processes incoming WhatsApp texts.
 */
export async function handleIncomingMessage(
  chatId: string,
  text: string,
  contactName: string = "",
  phoneNumber: string = ""
): Promise<{ text: string; imagePath?: string; redactAfterMs?: number }> {
  // 0. Intercept network switches first
  const cleanTextLower = text.trim().toLowerCase();
  if (cleanTextLower === "switch to mainnet" || cleanTextLower === "switch to testnet") {
    const newMode = cleanTextLower.includes("mainnet") ? "MAINNET" : "TESTNET";
    
    // Update sessionState
    const record = await prisma.sessionState.findUnique({ where: { chatId } });
    let state = record ? JSON.parse(record.stateJson) : {};
    state.networkMode = newMode;
    await prisma.sessionState.upsert({
      where: { chatId },
      create: { chatId, stateJson: JSON.stringify(state) },
      update: { stateJson: JSON.stringify(state) }
    });

    // Clear chat history to prevent context bleed
    await prisma.chatHistory.deleteMany({ where: { chatId } }).catch(() => {});

    const switchText = newMode === "MAINNET"
      ? `🔄 Switched to *Stellar Mainnet*! Standard transfers, swaps, and contract deployments will now run on the live network.\n\n*(Note: ZK Privacy Pool and ZK Confidential transfers remain on Testnet for demo purposes).*`
      : `🔄 Switched to *Stellar Testnet*! All features, including ZK Privacy and Confidential transfers, are now active in play-money sandbox mode.`;
    
    return { text: switchText };
  }

  // 1. Determine active network mode
  const sessionRecord = await prisma.sessionState.findUnique({ where: { chatId } });
  let networkMode: "TESTNET" | "MAINNET" = process.env.STELLAR_NETWORK === "MAINNET" ? "MAINNET" : "TESTNET";
  if (sessionRecord) {
    const state = JSON.parse(sessionRecord.stateJson);
    if (state.networkMode === "MAINNET" || state.networkMode === "TESTNET") {
      networkMode = state.networkMode;
    }
  }

  // 1.1 Intercept onboarding network choices
  let selectedOnboardNetwork: "TESTNET" | "MAINNET" | null = null;
  if (/\b(create|make|setup|new|generate)\b/i.test(cleanTextLower) && /\b(testnet|play|sandbox)\b/i.test(cleanTextLower)) {
    selectedOnboardNetwork = "TESTNET";
  } else if (/\b(create|make|setup|new|generate)\b/i.test(cleanTextLower) && /\b(mainnet|real|live)\b/i.test(cleanTextLower)) {
    selectedOnboardNetwork = "MAINNET";
  }

  if (selectedOnboardNetwork) {
    networkMode = selectedOnboardNetwork;
    // Save to session state so it is remembered
    const record = await prisma.sessionState.findUnique({ where: { chatId } });
    let state = record ? JSON.parse(record.stateJson) : {};
    state.networkMode = selectedOnboardNetwork;
    await prisma.sessionState.upsert({
      where: { chatId },
      create: { chatId, stateJson: JSON.stringify(state) },
      update: { stateJson: JSON.stringify(state) }
    });
  }

  // Run everything inside AsyncLocalStorage context
  return networkStorage.run(networkMode, async () => {
    // 2. Check if user already has an active wallet account
    let user = await prisma.user.findUnique({
      where: { chatId }
    });

    // Resolve raw phone number from contact details or chatId
    let rawNumber = phoneNumber.replace(/[^0-9]/g, "");
    if (!rawNumber && chatId.endsWith("@c.us")) {
      rawNumber = chatId.replace("@c.us", "");
    }

    // Healing & Merge logic: If a ghost account (onboarded: false) exists for this phone number:
    if (rawNumber) {
      // Fetch all non-onboarded users that are mobile chats to find a suffix match
      const orphans = await prisma.user.findMany({
        where: {
          onboarded: false,
          chatId: { endsWith: "@c.us" }
        }
      });

      const possibleOrphan = orphans.find(o => {
        const orphanNumber = o.chatId.replace("@c.us", "");
        const minLength = Math.min(orphanNumber.length, rawNumber.length);
        if (minLength < 7) return false;
        return orphanNumber.slice(-minLength) === rawNumber.slice(-minLength);
      });

      if (possibleOrphan) {
        if (user) {
          // SCENARIO: User has an active user record (e.g. created with an @lid ID) AND there is a ghost account
          // containing their funds. We merge them: keep the ghost wallet (with funds), delete the empty active
          // account, and associate the active chatId to the ghost account.
          console.log(`[Controller] Merging ghost account ${possibleOrphan.stellarPublic} into active user ${chatId}`);
          try {
            user = await prisma.$transaction(async (tx) => {
              // Re-map contacts saved on the active empty profile to the ghost account
              await tx.contact.updateMany({
                where: { ownerId: user!.id },
                data: { ownerId: possibleOrphan.id }
              });
              
              await tx.user.delete({
                where: { id: user!.id }
              });
              
              return await tx.user.update({
                where: { id: possibleOrphan.id },
                data: { chatId: chatId, phoneNumber: rawNumber, onboarded: true }
              });
            });
          } catch (mergeErr: any) {
            console.error(`[Controller] Merge failed (using existing):`, mergeErr.message);
            user = await prisma.user.findUnique({ where: { chatId } });
          }
        } else {
          // SCENARIO: Normal first message from the user JID (no active record yet)
          console.log(`[Controller] Healing orphaned account: ${possibleOrphan.chatId} -> ${chatId}`);
          try {
            user = await prisma.user.update({
              where: { id: possibleOrphan.id },
              data: { chatId: chatId, phoneNumber: rawNumber, onboarded: true }
            });
          } catch (healErr: any) {
            console.error(`[Controller] Healing update failed:`, healErr.message);
            user = await prisma.user.findUnique({ where: { chatId } });
          }
        }
      }
    }

    const isNewUser = !user || !user.onboarded;

    if (isNewUser) {
      // Accept natural variations like "Create a wallet", "make a wallet", "yes", "sure", "setup my address", etc.
      const isCreateWalletIntent = 
        selectedOnboardNetwork !== null ||
        /\b(create|make|start|setup|new|onboard|open|generate|register|begin|do\s+it)\b/i.test(cleanTextLower) ||
        /\b(yes|y|confirm|ok|okay|sure|agree)\b/i.test(cleanTextLower) ||
        /\b(wallet|account|address)\b/i.test(cleanTextLower);

      if (!isCreateWalletIntent) {
        return {
          text: `🚀 *Welcome to Stellapp*\n\n` +
            `The easiest way to use Stellar—right from WhatsApp.\n\n` +
            `✨ Create your wallet\n` +
            `💸 Send & receive crypto\n` +
            `🔄 Swap assets instantly\n` +
            `📜 Deploy smart contracts\n` +
            `⏱️ Automated recurring payments\n` +
            `🔒 Private blockchain transactions\n` +
            `🤖 AI assistance whenever you need it\n\n` +
            `Everything happens through a simple chat.\n\n` +
            `To get started, reply with:\n` +
            `👉 *create testnet wallet* (play-money sandbox)\n` +
            `👉 *create mainnet wallet* (real assets)`,
          imagePath: path.join(process.cwd(), 'public', 'assets', 'onboarding.png')
        };
      }

      console.log(`[Controller] Creating wallet for user: ${chatId} (${contactName}) on ${networkMode}`);
      
      // Generate default username from WhatsApp profile name
      let defaultUsername: string | null = contactName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (defaultUsername.length < 3 || defaultUsername.length > 15) {
        const cleanSuffix = chatId.split("@")[0].slice(-4);
        defaultUsername = `user${cleanSuffix}`;
      }

      if (defaultUsername) {
        const taken = await prisma.user.findFirst({
          where: { username: defaultUsername }
        });
        if (taken && taken.chatId !== chatId) {
          const cleanNumber = chatId.split("@")[0].slice(-4);
          defaultUsername = `${defaultUsername}${cleanNumber}`;
        }
      }

      if (!user) {
        // Generate Stellar keys (EVM removed entirely)
        const stellarWallet = createStellarWallet();
        // Temporary placeholder — userId not yet known before upsert.
        // We'll re-encrypt with per-user key immediately after the user row is created.
        const encryptedStellarSecret = encryptForUser(stellarWallet.secretKey, chatId);

        try {
          user = await prisma.user.upsert({
            where: { chatId },
            create: {
              chatId,
              phoneNumber: rawNumber || null,
              username: defaultUsername,
              stellarPublic: stellarWallet.publicKey,
              stellarSecret: encryptedStellarSecret,
              onboarded: true
            },
            update: {
              onboarded: true,
              phoneNumber: rawNumber || undefined,
              username: defaultUsername ?? undefined
            }
          });
        } catch (createErr: any) {
          console.error(`[Controller] upsert failed, fetching existing record:`, createErr.message);
          user = await prisma.user.findUnique({ where: { chatId } });
          if (!user) throw createErr;
        }
        console.log(`[Controller] New user wallet created: ${user.stellarPublic}`);
      } else {
        user = await prisma.user.update({
          where: { chatId },
          data: {
            username: user.username || defaultUsername,
            phoneNumber: user.phoneNumber || rawNumber || undefined,
            onboarded: true
          }
        });
        console.log(`[Controller] Onboarded pre-created user: ${user.stellarPublic}`);
      }

      let fundingStatus = "";
      if (networkMode === "TESTNET") {
        console.log(`[Controller] Funding Stellar account on Testnet for: ${user.stellarPublic}`);
        const funded = await fundStellarAccount(user.stellarPublic);
        if (funded) {
          try {
            console.log(`[Controller] Establishing USDC trustline on Testnet for: ${user.stellarPublic}`);
            const { plaintext: secret, migrated } = decryptForUserWithMigration(user.stellarSecret, user.id);
            if (migrated) {
              // Transparently re-encrypt with per-user key and persist
              await prisma.user.update({ where: { id: user.id }, data: { stellarSecret: encryptForUser(secret, user.id) } });
              console.log(`[Controller] Migrated stellarSecret to per-user HKDF key for user ${user.id}`);
            }
            await ensureUSDCTrustline(secret);
          } catch (e) {
            console.error(`[Controller] Failed to establish USDC trustline:`, e);
          }
        }
        fundingStatus = funded 
          ? "🎁 I've funded your Stellar wallet with *10,000 Testnet XLM* and a USDC trustline so you can start immediately!" 
          : "⚠️ I tried to fund your Stellar account with testnet XLM but Friendbot was busy. Try typing 'fund me' in a moment!";
      } else {
        fundingStatus = `⚠️ *Account Not Yet Active*\n\nTo activate your Stellar wallet, please send a minimum of *2 XLM* to your address:\n\n\`${user.stellarPublic}\`\n\nOnce received, type: *"activate my account"* and I'll set up everything automatically (USDC trustline, etc.).`;
      }

      const usernameStatus = user.username 
        ? `🏷️ *Your Username:* *${user.username}* (Address: \`${user.username}*stellapp.com\`)\n\n`
        : "";

      const zkPrivacyStatus = networkMode === "TESTNET"
        ? `🛡️ *ZK Privacy Enabled*\n` +
          `Send assets confidentially on-chain using zero-knowledge proofs.\n\n`
        : `🔒 *Secure Mainnet Mode*\n` +
          `Standard payments, swaps, and smart contracts are fully active with real assets.\n\n`;

      const welcomeText = `✨ *Wallet Created Successfully!* 💳\n` +
        `Active Network: *Stellar ${networkMode === "MAINNET" ? "Mainnet" : "Testnet"}*\n\n` +
        `Your personal Stellar wallet is active:\n` +
        `\`${user.stellarPublic}\`\n\n` +
        usernameStatus +
        `${fundingStatus}\n\n` +
        zkPrivacyStatus +
        `To get started, try replying:\n` +
        `👉 *"Check my balance"* or *"Send 10 USDC"*`;
      
      await appendChatRound(chatId, text, welcomeText);
      return { text: welcomeText };
    }

    if (!user) {
      throw new Error("Failed to load user record.");
    }

    // ── Route directly to AI agent loop for a unified AI experience ──────────
    try {
      const aiResponse = await runAgentLoop(chatId, text, {
        id: user.id,
        stellarPublic: user.stellarPublic,
        stellarSecret: user.stellarSecret,
      }, true); // Always use primary agent model (gpt-4o) for high accuracy
      
      const isExportMsg = aiResponse.includes("🔑 *Wallet Export Details*") || aiResponse.includes("*Secret Key:*");
      return { 
        text: aiResponse,
        redactAfterMs: isExportMsg ? 300000 : undefined
      };
    } catch (error: any) {
      console.error(`[Controller] Agent loop error for user ${chatId}:`, error.message);
      throw error;
    }
  });
}
