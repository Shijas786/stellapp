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

  const isNewUser = !user || !user.onboarded;

  if (isNewUser) {
    console.log(`[Controller] Onboarding user: ${chatId} (${contactName})`);
    
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
        // Append last 4 digits of phone number to make it unique
        const cleanNumber = chatId.split("@")[0].slice(-4);
        defaultUsername = `${defaultUsername}${cleanNumber}`;
      }
    }

    if (!user) {
      // Generate Stellar keys
      const stellarWallet = createStellarWallet();
      
      // Generate EVM keys
      const evmWallet = createEVMWallet();

      // Encrypt private keys
      const encryptedStellarSecret = encrypt(stellarWallet.secretKey);
      const encryptedEVMPrivateKey = encrypt(evmWallet.privateKey);

      // Save to Database
      user = await prisma.user.create({
        data: {
          chatId,
          username: defaultUsername,
          stellarPublic: stellarWallet.publicKey,
          stellarSecret: encryptedStellarSecret,
          evmAddress: evmWallet.address,
          evmPrivateKey: encryptedEVMPrivateKey,
          onboarded: true
        }
      });
      console.log(`[Controller] New user wallet created: ${user.stellarPublic}`);
    } else {
      // Update existing pre-created user to onboarded = true
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
    const networkNameEVM = config.isMainnet ? "Base Mainnet" : "Base Sepolia";

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
        ? "🎁 I've funded your Stellar wallet with *10,000 Testnet XLM* and a USDC Trustline so you can start immediately!" 
        : "⚠️ I tried to fund your Stellar account with testnet XLM but Friendbot was busy. Try typing 'fund me' in a moment!";
    } else {
      fundingStatus = `⚠️ *Account Not Yet Active*\n\nTo activate your Stellar wallet, please send a minimum of *2 XLM* to your address:\n\n\`${user.stellarPublic}\`\n\nOnce received, type: *"activate my account"* and I'll set up everything automatically (USDC trustline, etc.).`;
    }

    const usernameStatus = user.username 
      ? `🏷️ *Your Username:* *${user.username}* (Address: \`${user.username}*stellapp.com\`)\n\n`
      : "";

    return `👋 *Welcome to Stellapp!* 🚀\n\n` +
      `Your personal crypto wallet, right inside WhatsApp. You can send payments, swap tokens, bridge between networks, and even deploy smart contracts just by texting or sending a voice note. 🎙️\n\n` +
      `I've securely generated your wallets:\n\n` +
      `✨ *Stellar (${networkNameStellar}):*\n\`${user.stellarPublic}\`\n\n` +
      `⛓️ *EVM (${networkNameEVM}):*\n\`${user.evmAddress}\`\n\n` +
      usernameStatus +
      `${fundingStatus}\n\n` +
      `💡 *Try sending:* "What's my balance?", "Send 10 USDC to John", or "Deploy an escrow contract for 2 days"`;
  }

  if (!user) {
    throw new Error("Failed to load user record.");
  }

  // 2. Pass existing user messages to the AI Agent runtime
  try {
    const aiResponse = await runAgentLoop(chatId, text, {
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
