import { config } from "../services/config";
import { prisma } from "../services/db";
import { encrypt, decrypt } from "../services/encryption";
import { createStellarWallet, fundStellarAccount, ensureUSDCTrustline } from "../services/stellar";
import { createEVMWallet } from "../services/evm";
import { runAgentLoop } from "../agent/agent";

/**
 * Main coordinator function that processes incoming WhatsApp texts.
 */
export async function handleIncomingMessage(
  chatId: string,
  text: string,
  contactName: string = ""
): Promise<string> {
  // 1. Check if user already has an active wallet account
  let user = await prisma.user.findUnique({
    where: { chatId }
  });

  // Healing logic: If user is not found by exact chatId, look for a pre-created "ghost" account
  // that tools.ts may have created with a shorter/different phone format.
  // We ONLY heal if the chatId ends with @c.us (real phone) and the raw number is a suffix match
  // of an existing record. This avoids false merges between different phone numbers.
  if (!user && chatId.endsWith("@c.us")) {
    const rawNumber = chatId.replace("@c.us", "");

    // Find any orphan whose chatId ends with the same full number (catches country-code variants)
    const possibleOrphan = await prisma.user.findFirst({
      where: {
        AND: [
          { chatId: { endsWith: `${rawNumber}@c.us` } },
          { onboarded: false }
        ]
      }
    });

    // Safety: only merge if the orphan's number IS a suffix of ours (avoids partial collisions)
    if (possibleOrphan) {
      const orphanNumber = possibleOrphan.chatId.replace("@c.us", "");
      const isValidSuffix = rawNumber.endsWith(orphanNumber) || orphanNumber.endsWith(rawNumber);
      if (isValidSuffix) {
        console.log(`[Controller] Healing orphaned account: ${possibleOrphan.chatId} -> ${chatId}`);
        try {
          user = await prisma.user.update({
            where: { id: possibleOrphan.id },
            data: { chatId: chatId }
          });
        } catch (healErr: any) {
          // If another row with this chatId was created in a race, just fetch it
          console.error(`[Controller] Healing update failed (race condition?):`, healErr.message);
          user = await prisma.user.findUnique({ where: { chatId } });
        }
      }
    }
  }

  const isNewUser = !user || !user.onboarded;

  if (isNewUser) {
    const cleanText = text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (cleanText !== "create wallet") {
      return `👋 *Welcome to Stellapp!* 🚀\n\n` +
        `Your personal zero-knowledge crypto companion, right inside WhatsApp. \n\n` +
        `Manage assets, swap tokens on the Stellar DEX, perform private ZK transfers, and deploy smart contracts—all with zero gas fees. 🎙️\n\n` +
        `To get started and generate your secure Stellar wallet, please reply:\n` +
        `👉 *"create wallet"*`;
    }

    console.log(`[Controller] Creating wallet for user: ${chatId} (${contactName})`);
    
    // Generate default username from WhatsApp profile name
    let defaultUsername: string | null = contactName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (defaultUsername.length < 3 || defaultUsername.length > 15) {
      defaultUsername = null;
    }

    if (defaultUsername) {
      const taken = await prisma.user.findFirst({
        where: { username: defaultUsername }
      });
      if (taken) {
        const cleanNumber = chatId.split("@")[0].slice(-4);
        defaultUsername = `${defaultUsername}${cleanNumber}`;
      }
    }

    if (!user) {
      // Generate Stellar keys (EVM removed entirely)
      const stellarWallet = createStellarWallet();
      const encryptedStellarSecret = encrypt(stellarWallet.secretKey);

      try {
        user = await prisma.user.upsert({
          where: { chatId },
          create: {
            chatId,
            username: defaultUsername,
            stellarPublic: stellarWallet.publicKey,
            stellarSecret: encryptedStellarSecret,
            onboarded: true
          },
          update: {
            onboarded: true,
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
          onboarded: true
        }
      });
      console.log(`[Controller] Onboarded pre-created user: ${user.stellarPublic}`);
    }

    const networkNameStellar = config.isMainnet ? "Mainnet" : "Testnet";
    let fundingStatus = "";
    if (!config.isMainnet) {
      console.log(`[Controller] Funding Stellar account on Testnet for: ${user.stellarPublic}`);
      const funded = await fundStellarAccount(user.stellarPublic);
      if (funded) {
        try {
          console.log(`[Controller] Establishing USDC trustline on Testnet for: ${user.stellarPublic}`);
          await ensureUSDCTrustline(decrypt(user.stellarSecret));
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

    return `✨ *Wallet Created Successfully!* 💳\n\n` +
      `Your personal Stellar wallet is active:\n` +
      `\`${user.stellarPublic}\`\n\n` +
      usernameStatus +
      `${fundingStatus}\n\n` +
      `🛡️ *ZK Privacy Enabled*\n` +
      `Send assets confidentially on-chain using zero-knowledge proofs.\n\n` +
      `To get started, try replying:\n` +
      `👉 *"Check my balance"* or *"Send 10 USDC"*`;
  }

  if (!user) {
    throw new Error("Failed to load user record.");
  }

  // 2. Pass existing user messages to the AI Agent runtime
  try {
    const aiResponse = await runAgentLoop(chatId, text, {
      id: user.id,
      stellarPublic: user.stellarPublic,
      stellarSecret: user.stellarSecret,
      evmAddress: user.evmAddress,
      evmPrivateKey: user.evmPrivateKey
    });
    return aiResponse;
  } catch (error: any) {
    console.error(`[Controller] Agent loop error for user ${chatId}:`, error.message);
    throw error;
  }
}
