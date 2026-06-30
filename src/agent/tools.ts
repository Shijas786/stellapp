import { encrypt, decrypt } from "../services/encryption";
import * as stellar from "../services/stellar";
import * as evm from "../services/evm";
import * as cctp from "../services/cctp";
import { config } from "../services/config";
import { compileRustContract } from "../services/compiler";
import { prisma } from "../services/db";
import crypto from "crypto";
import { ethers } from "ethers";

// --- Per-user rate limiter (max 1 tool call per 3 seconds) ---
const rateLimitMap = new Map<string, number>();
function checkRateLimit(chatId: string): void {
  const now = Date.now();
  const last = rateLimitMap.get(chatId) ?? 0;
  if (now - last < 3000) {
    throw new Error("⏳ Please slow down! One action at a time. Try again in a moment.");
  }
  rateLimitMap.set(chatId, now);
}

// Global sender placeholder for background notifications
export let sendNotification: (chatId: string, text: string) => Promise<void> = async () => {
  console.log("Notification sender not configured yet.");
};

export function setNotificationSender(sender: typeof sendNotification) {
  sendNotification = sender;
}

export interface UserWalletData {
  stellarPublic: string;
  stellarSecret: string; // Encrypted
  evmAddress: string;
  evmPrivateKey: string; // Encrypted
}

/**
 * Dispatches and executes local tools based on LLM function calls.
 */
export async function executeTool(
  chatId: string,
  name: string,
  args: any,
  user: UserWalletData
): Promise<any> {
  console.log(`[Agent Tool] Executing tool: ${name} with args:`, args);

  // Rate limit all tool calls (except read-only balance/address checks)
  const skipRateLimit = ["get_balances", "get_wallet_address", "check_activation"];
  if (!skipRateLimit.includes(name)) {
    checkRateLimit(chatId);
  }

  switch (name) {
    case "get_balances": {
      const stellarBalances = await stellar.getBalances(user.stellarPublic);
      const evmBalances = await evm.getEVMBalances(user.evmAddress);
      return {
        stellar: stellarBalances,
        evm: evmBalances
      };
    }

    case "get_wallet_address": {
      return {
        stellarAddress: user.stellarPublic,
        evmAddress: user.evmAddress,
        message: `Your wallet addresses:\n\nStellar: ${user.stellarPublic}\nEVM: ${user.evmAddress}`
      };
    }

    case "get_transaction_history": {
      const limit = args.limit ? Math.min(parseInt(args.limit), 20) : 10;
      const txs = await stellar.getTransactionHistory(user.stellarPublic, limit);
      const spendable = await stellar.getSpendableXlmBalance(user.stellarPublic);
      return {
        transactions: txs,
        spendableXlm: spendable.spendable,
        reservedXlm: spendable.reserved,
        count: txs.length
      };
    }

    case "check_activation": {
      const activated = await stellar.isAccountActivated(user.stellarPublic);
      if (!activated) {
        return {
          activated: false,
          message: `Your wallet (${user.stellarPublic}) has not received XLM yet. Please send at least 2 XLM to that address, then try again.`
        };
      }

      // Account has XLM — ensure USDC trustline is established
      const stellarSecret = decrypt(user.stellarSecret);
      let trustlineSetup = false;
      try {
        await stellar.ensureUSDCTrustline(stellarSecret);
        trustlineSetup = true;
      } catch (e: any) {
        console.error("[Tools] Trustline setup failed:", e.message);
      }

      return {
        activated: true,
        trustlineReady: trustlineSetup,
        message: trustlineSetup
          ? `✅ Your account is fully activated and ready! XLM received and USDC trustline established. You can now send, receive, and swap USDC.`
          : `✅ Your account is activated (XLM received), but USDC trustline setup failed. Please type "activate my account" again to retry.`
      };
    }

    case "send_stellar": {
      const stellarSecret = decrypt(user.stellarSecret);
      let recipient = args.recipient.trim();

      // Check if recipient is a custom username or phone number instead of standard key (does not start with G or C)
      if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
        const isPhone = /^\+?[0-9]{10,15}$/.test(recipient);
        if (isPhone) {
          const cleanPhone = recipient.replace("+", "");
          console.log(`[Tools] Recipient is a phone number. Resolving: ${cleanPhone}`);
          
          let resolved = await prisma.user.findFirst({
            where: {
              chatId: {
                startsWith: cleanPhone
              }
            }
          });

          if (!resolved) {
            console.log(`[Tools] Phone number ${cleanPhone} not registered. Generating wallets on-the-fly...`);
            
            // 1. Generate wallets
            const newStellar = stellar.createStellarWallet();
            const newEVM = evm.createEVMWallet();

            // 2. Encrypt private keys
            const encStellarSecret = encrypt(newStellar.secretKey);
            const encEVMPrivateKey = encrypt(newEVM.privateKey);

            // 3. Save to database (onboarded is false because they haven't chatted with the bot yet)
            resolved = await prisma.user.create({
              data: {
                chatId: `${cleanPhone}@c.us`,
                stellarPublic: newStellar.publicKey,
                stellarSecret: encStellarSecret,
                evmAddress: newEVM.address,
                evmPrivateKey: encEVMPrivateKey,
                onboarded: false
              }
            });

            // 4. Fund Stellar account (testnet only — mainnet requires user to send XLM first)
            if (!config.isMainnet) {
              console.log(`[Tools] Funding pre-created account: ${newStellar.publicKey}`);
              await stellar.fundStellarAccount(newStellar.publicKey);
              // Trustline only after account is funded (requires XLM for fee)
              console.log(`[Tools] Establishing USDC trustline for pre-created account...`);
              await stellar.ensureUSDCTrustline(newStellar.secretKey);
            }
            // On mainnet: skip trustline — account has no XLM yet, sender's USDC will arrive via path payment
          }

          // Notify the unregistered recipient via WhatsApp
          try {
            await sendNotification(
              `${cleanPhone}@c.us`,
              `💸 *You've received a payment!*\n\nSomeone sent you tokens on Stellar via Stellapp Bot.\n\n` +
              `Your wallet address: \`${resolved.stellarPublic}\`\n\n` +
              `Text me *"What's my balance?"* to check your balance, or *"activate my account"* if you're on Mainnet!`
            );
          } catch {
            // Non-critical — recipient notification failure shouldn't block the send
          }

          console.log(`[Tools] Resolved phone number '${recipient}' to public address: ${resolved.stellarPublic}`);
          recipient = resolved.stellarPublic;
        } else {
          console.log(`[Tools] Recipient is a username. Resolving: ${recipient}`);
          const username = recipient.split("*")[0].toLowerCase();
          const resolved = await prisma.user.findUnique({
            where: { username }
          });
          if (!resolved) {
            throw new Error(`Username '${recipient}' could not be resolved to any active Stellar wallet.`);
          }
          console.log(`[Tools] Resolved username '${username}' to public address: ${resolved.stellarPublic}`);
          recipient = resolved.stellarPublic;
        }
      }

      const isUSDC = args.asset === "USDC";

      if (isUSDC) {
        // Verify recipient has USDC trustline
        const hasTrust = await stellar.checkRecipientUSDCTrustline(recipient);
        if (!hasTrust) {
          throw new Error(
            `Recipient address ${recipient} does not have a USDC trustline. Ask them to establish a trustline for USDC before sending.`
          );
        }
      }

      const txHash = await stellar.sendStellarToken(
        stellarSecret,
        recipient,
        args.amount,
        isUSDC
      );

      return {
        success: true,
        recipient,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`
      };
    }

    case "swap_stellar": {
      const stellarSecret = decrypt(user.stellarSecret);
      const txHash = await stellar.swapTokens(stellarSecret, args.amount, args.direction);

      return {
        success: true,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`
      };
    }

    case "bridge_evm_to_stellar": {
      const evmPrivateKey = decrypt(user.evmPrivateKey);
      const stellarSecret = decrypt(user.stellarSecret);

      // Ensure user has USDC trustline on Stellar first so the mint doesn't fail
      await stellar.ensureUSDCTrustline(stellarSecret);

      // 1. Fire the burn transaction on EVM
      const { txHash: evmTxHash, messageHash, messageBytes } = await evm.burnUSDCForCCTP(
        evmPrivateKey,
        args.amount,
        user.stellarPublic
      );

      // 2. Start polling and minting asynchronously in the background
      // This allows the bot to reply to the user immediately on WhatsApp instead of blocking for 1+ minute
      runBridgeBackgroundWorker(chatId, stellarSecret, messageHash, messageBytes, args.amount);

      return {
        success: true,
        burnTxHash: evmTxHash,
        explorerUrl: `${config.explorerUrlBase}${evmTxHash}`,
        message: `Bridging initialized. Burn Tx: ${evmTxHash}. I will notify you here once the USDC arrives on Stellar (takes about 30 seconds)!`
      };
    }

    case "deploy_escrow_contract": {
      const stellarSecret = decrypt(user.stellarSecret);
      const { contractId, txHash } = await stellar.deployEscrowContract(
        stellarSecret,
        args.recipientAddress,
        args.arbiterAddress,
        args.maxAmount
      );

      return {
        success: true,
        contractId,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        contractExplorerUrl: `${config.explorerUrlStellarContract}${contractId}`
      };
    }

    case "release_escrow": {
      const stellarSecret = decrypt(user.stellarSecret);
      const txHash = await stellar.releaseEscrowContract(stellarSecret, args.contractId);

      return {
        success: true,
        contractId: args.contractId,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`
      };
    }

    case "refund_escrow": {
      const stellarSecret = decrypt(user.stellarSecret);
      const txHash = await stellar.refundEscrowContract(stellarSecret, args.contractId);

      return {
        success: true,
        contractId: args.contractId,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`
      };
    }

    case "deploy_custom_contract": {
      const stellarSecret = decrypt(user.stellarSecret);
      
      // 1. Compile Rust source code to WASM binary using cached cargo compiler
      console.log(`[Tools] Starting custom contract compilation...`);
      const wasmBytes = compileRustContract(args.rustCode);
      
      // 2. Upload WASM bytes on-chain
      console.log(`[Tools] Uploading WASM bytecode on-chain...`);
      const { wasmHash, txHash: uploadTxHash } = await stellar.uploadWasm(stellarSecret, wasmBytes);
      console.log(`[Tools] Contract WASM uploaded. Hash: ${wasmHash}`);
      
      // 3. Instantiate the contract instance on-chain
      console.log(`[Tools] Instantiating contract instance from WASM hash...`);
      const { contractId, txHash: instantiateTxHash } = await stellar.instantiateContract(stellarSecret, wasmHash);
      console.log(`[Tools] Deployed custom contract ID: ${contractId}`);

      return {
        success: true,
        contractId,
        wasmHash,
        uploadTxHash,
        instantiateTxHash,
        explorerUrl: `${config.explorerUrlStellar}${instantiateTxHash}`,
        contractExplorerUrl: `${config.explorerUrlStellarContract}${contractId}`
      };
    }

    case "register_username": {
      const username = args.username.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (username.length < 3 || username.length > 15) {
        throw new Error("Username must be between 3 and 15 alphanumeric characters.");
      }

      const existing = await prisma.user.findFirst({
        where: { username }
      });
      if (existing) {
        throw new Error(`Username '${username}' is already taken.`);
      }

      await prisma.user.update({
        where: { chatId },
        data: { username }
      });

      return {
        success: true,
        username,
        federatedAddress: `${username}*bot.com`
      };
    }

    case "deploy_privacy_pool": {
      const stellarSecret = decrypt(user.stellarSecret);
      const { contractId, txHash } = await stellar.deployPrivacyPool(stellarSecret);

      return {
        success: true,
        contractId,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        contractExplorerUrl: `${config.explorerUrlStellarContract}${contractId}`
      };
    }

    case "deposit_private_pool": {
      const stellarSecret = decrypt(user.stellarSecret);
      
      // 1. Generate secret & nullifier
      const secret = crypto.randomBytes(32);
      const nullifier = crypto.randomBytes(32);
      
      // 2. Build 16-byte big-endian amount buffer
      const amountStr = args.amount;
      const amountBI = BigInt(Math.floor(parseFloat(amountStr) * 10000000));
      const amountBuf = Buffer.alloc(16);
      amountBuf.writeBigUInt64BE(amountBI >> 64n, 0);
      amountBuf.writeBigUInt64BE(amountBI & 0xffffffffffffffffn, 8);

      // 3. Compute commitment
      const preimage = Buffer.concat([secret, nullifier, amountBuf]);
      const commitment = ethers.keccak256(preimage);
      const commitmentHex = commitment.slice(2); // strip "0x"

      // 4. Perform deposit
      const txHash = await stellar.depositToPrivacyPool(
        stellarSecret,
        args.contractId,
        commitmentHex,
        amountStr
      );

      // 5. Generate client secret note format
      const secretNote = `stellapp-note-v1_${args.contractId}_${amountStr}_${secret.toString("hex")}_${nullifier.toString("hex")}`;

      return {
        success: true,
        commitmentHex,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        secretNote,
        message: `Successfully deposited ${amountStr} USDC into the Privacy Pool! 🤫\n\nSave this secret note to withdraw your funds later or send it to someone else:\n\n\`${secretNote}\``
      };
    }

    case "withdraw_private_pool": {
      const stellarSecret = decrypt(user.stellarSecret);
      
      // Parse the secret note
      const noteStr: string = args.secretNote.trim();
      const parts = noteStr.split("_");
      if (parts.length !== 5 || parts[0] !== "stellapp-note-v1") {
        throw new Error("Invalid secret note format. Must start with 'stellapp-note-v1_'.");
      }

      const contractId = parts[1];
      const amountStr = parts[2];
      const secretHex = parts[3];
      const nullifierHex = parts[4];

      // Withdraw using user's main wallet as the recipient
      const txHash = await stellar.withdrawFromPrivacyPool(
        stellarSecret,
        contractId,
        user.stellarPublic,
        secretHex,
        nullifierHex,
        amountStr
      );

      return {
        success: true,
        contractId,
        amount: amountStr,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`
      };
    }

    default:
      throw new Error(`Tool ${name} is not implemented.`);
  }
}

/**
 * Background worker to poll Circle attestation and execute mint on Stellar.
 */
function runBridgeBackgroundWorker(
  chatId: string,
  stellarSecret: string,
  messageHash: string,
  messageBytes: string,
  amount: string
) {
  Promise.resolve()
    .then(async () => {
      // 1. Poll attestation (retries every 10s)
      const attestationHex = await cctp.pollForCircleAttestation(messageHash);
      
      // 2. Submit mint on Stellar
      const mintTxHash = await cctp.mintUSDCOnStellar(stellarSecret, messageBytes, attestationHex);
      
      // 3. Notify user via WhatsApp
      await sendNotification(
        chatId,
        `🎉 *Bridge Complete!* \n\nSuccessfully bridged *${amount} USDC* to your Stellar account!\n\n🔗 *Mint Transaction:* ${config.explorerUrlStellar}${mintTxHash}`
      );
    })
    .catch(async (error: any) => {
      console.error("[CCTP Background Worker] Bridging failed:", error.message);
      await sendNotification(
        chatId,
        `⚠️ *Bridge Failed!* \n\nFailed to mint your *${amount} USDC* on Stellar: ${error.message}. Please contact support with message hash:\n\`${messageHash}\``
      );
    });
}
