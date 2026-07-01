import { encrypt, decrypt } from "../services/encryption";
import * as stellar from "../services/stellar";
import * as evm from "../services/evm";
import * as cctp from "../services/cctp";
import { config } from "../services/config";
import { compileRustContract } from "../services/compiler";
import { prisma } from "../services/db";
import crypto from "crypto";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { exec } from "child_process";
import * as templates from "./templates";
import * as zkPool from "../services/zk_pool";


// ============================================================
// HARDCODED SOROBAN v21.7.7 CONTRACT TEMPLATES
// These are proven, compiler-verified templates. NEVER let the
// AI generate Rust code from scratch — it always hallucinates.
// ============================================================
function getTokenContractTemplate(name: string, symbol: string, initialSupply: string, decimals: string): string {
  return `#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

// Token Name: ${name} | Symbol: ${symbol} | Decimals: ${decimals}
const INITIAL_SUPPLY: i128 = ${initialSupply};

#[contracttype]
pub enum DataKey {
    Balance(Address),
    TotalSupply,
    Admin,
    Decimals,
}

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &INITIAL_SUPPLY);
        env.storage().instance().set(&DataKey::Decimals, &${decimals}i32);
        env.storage().instance().set(&DataKey::Balance(admin.clone()), &INITIAL_SUPPLY);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_bal: i128 = env.storage().instance().get(&DataKey::Balance(from.clone())).unwrap_or(0);
        let to_bal: i128 = env.storage().instance().get(&DataKey::Balance(to.clone())).unwrap_or(0);
        if from_bal < amount {
            panic!("insufficient balance");
        }
        env.storage().instance().set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        env.storage().instance().set(&DataKey::Balance(to.clone()), &(to_bal + amount));
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balance(owner)).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn decimals(env: Env) -> i32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(7)
    }
}
`;
}

function getNftContractTemplate(name: string, symbol: string, maxSupply: string): string {
  return `#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

// NFT Name: ${name} | Symbol: ${symbol} | Max Supply: ${maxSupply}
const MAX_SUPPLY: u32 = ${maxSupply};

#[contracttype]
pub enum DataKey {
    Owner(u32),
    TotalSupply,
    Admin,
}

#[contract]
pub struct NftContract;

#[contractimpl]
impl NftContract {
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0u32);
    }

    pub fn mint(env: Env, to: Address) -> u32 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let supply: u32 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        if supply >= MAX_SUPPLY {
            panic!("max supply reached");
        }
        let new_id = supply + 1;
        env.storage().instance().set(&DataKey::Owner(new_id), &to);
        env.storage().instance().set(&DataKey::TotalSupply, &new_id);
        new_id
    }

    pub fn transfer(env: Env, from: Address, to: Address, nft_id: u32) {
        from.require_auth();
        let owner: Address = env.storage().instance().get(&DataKey::Owner(nft_id)).expect("NFT not found");
        if owner != from {
            panic!("not the owner");
        }
        env.storage().instance().set(&DataKey::Owner(nft_id), &to);
    }

    pub fn owner_of(env: Env, nft_id: u32) -> Option<Address> {
        env.storage().instance().get(&DataKey::Owner(nft_id))
    }

    pub fn total_supply(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }
}
`;
}

// ---- TIMELOCK / VESTING (from stellar/soroban-examples/timelock) ----
function getTimelockContractTemplate(beneficiary: string, unlockLedger: string, amount: string): string {
  return `#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Beneficiary,
    UnlockLedger,
    Amount,
    Initialized,
}

#[contract]
pub struct TimelockContract;

#[contractimpl]
impl TimelockContract {
    pub fn initialize(env: Env, admin: Address, token_address: Address, amount: i128) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("already initialized");
        }
        let beneficiary = Address::from_string(&soroban_sdk::String::from_str(&env, "${beneficiary}"));
        env.storage().instance().set(&DataKey::Beneficiary, &beneficiary);
        env.storage().instance().set(&DataKey::UnlockLedger, &${unlockLedger}u32);
        env.storage().instance().set(&DataKey::Amount, &amount);
        env.storage().instance().set(&DataKey::Initialized, &true);
        // Transfer tokens into the contract
        token::Client::new(&env, &token_address).transfer(&admin, &env.current_contract_address(), &amount);
    }

    pub fn claim(env: Env, token_address: Address) {
        let beneficiary: Address = env.storage().instance().get(&DataKey::Beneficiary).unwrap();
        beneficiary.require_auth();
        let unlock_ledger: u32 = env.storage().instance().get(&DataKey::UnlockLedger).unwrap();
        if env.ledger().sequence() < unlock_ledger {
            panic!("tokens are still locked");
        }
        let amount: i128 = env.storage().instance().get(&DataKey::Amount).unwrap();
        token::Client::new(&env, &token_address).transfer(&env.current_contract_address(), &beneficiary, &amount);
        env.storage().instance().set(&DataKey::Amount, &0i128);
    }

    pub fn unlock_ledger(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::UnlockLedger).unwrap_or(0)
    }
}
`;
}

// ---- STAKING ----
function getStakingContractTemplate(name: string): string {
  return `#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

// Staking Contract: ${name}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Stake(Address),
    TotalStaked,
    RewardRate,
    Admin,
    StakeToken,
}

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    pub fn initialize(env: Env, admin: Address, stake_token: Address, reward_rate: i128) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakeToken, &stake_token);
        env.storage().instance().set(&DataKey::RewardRate, &reward_rate);
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
    }

    pub fn stake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("amount must be positive"); }
        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(&user, &env.current_contract_address(), &amount);
        let current: i128 = env.storage().instance().get(&DataKey::Stake(user.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Stake(user.clone()), &(current + amount));
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total + amount));
    }

    pub fn unstake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        let current: i128 = env.storage().instance().get(&DataKey::Stake(user.clone())).unwrap_or(0);
        if current < amount { panic!("insufficient stake"); }
        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(&env.current_contract_address(), &user, &amount);
        env.storage().instance().set(&DataKey::Stake(user.clone()), &(current - amount));
        let total: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalStaked, &(total - amount));
    }

    pub fn get_stake(env: Env, user: Address) -> i128 {
        env.storage().instance().get(&DataKey::Stake(user)).unwrap_or(0)
    }

    pub fn total_staked(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0)
    }
}
`;
}

// ---- VOTING / GOVERNANCE ----
function getVotingContractTemplate(name: string, proposal: string): string {
  return `#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec, String};

// Voting Contract: ${name}
// Proposal: ${proposal}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Vote(Address),
    YesVotes,
    NoVotes,
    Deadline,
    Admin,
    Finalized,
}

#[contract]
pub struct VotingContract;

#[contractimpl]
impl VotingContract {
    pub fn initialize(env: Env, admin: Address, deadline_ledger: u32) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Deadline, &deadline_ledger);
        env.storage().instance().set(&DataKey::YesVotes, &0u32);
        env.storage().instance().set(&DataKey::NoVotes, &0u32);
        env.storage().instance().set(&DataKey::Finalized, &false);
    }

    pub fn vote(env: Env, voter: Address, approve: bool) {
        voter.require_auth();
        let deadline: u32 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().sequence() > deadline { panic!("voting period has ended"); }
        if env.storage().instance().has(&DataKey::Vote(voter.clone())) { panic!("already voted"); }
        env.storage().instance().set(&DataKey::Vote(voter.clone()), &approve);
        if approve {
            let yes: u32 = env.storage().instance().get(&DataKey::YesVotes).unwrap_or(0);
            env.storage().instance().set(&DataKey::YesVotes, &(yes + 1));
        } else {
            let no: u32 = env.storage().instance().get(&DataKey::NoVotes).unwrap_or(0);
            env.storage().instance().set(&DataKey::NoVotes, &(no + 1));
        }
    }

    pub fn results(env: Env) -> (u32, u32) {
        let yes: u32 = env.storage().instance().get(&DataKey::YesVotes).unwrap_or(0);
        let no: u32 = env.storage().instance().get(&DataKey::NoVotes).unwrap_or(0);
        (yes, no)
    }

    pub fn has_voted(env: Env, voter: Address) -> bool {
        env.storage().instance().has(&DataKey::Vote(voter))
    }
}
`;
}

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
  const skipRateLimit = ["get_balances", "get_wallet_address", "check_activation", "list_skills", "read_skill"];
  if (!skipRateLimit.includes(name)) {
    checkRateLimit(chatId);
  }

  switch (name) {
    case "list_skills": {
      const skillsDir = path.join(process.cwd(), ".agents/skills");
      if (!fs.existsSync(skillsDir)) {
        return "No skills directory found in the workspace.";
      }
      
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      return dirs.map(dirName => {
        const skillFile = path.join(skillsDir, dirName, "SKILL.md");
        const content = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, "utf-8") : "";
        const descMatch = content.match(/description:\s*(.+)/i);
        return { name: dirName, description: descMatch?.[1] ?? "No description available" };
      });
    }

    case "read_skill": {
      const skillName = args.skillName;
      if (!skillName || typeof skillName !== "string") {
        return "Error: skillName must be a string.";
      }

      // 1. Regex validation: allow alphanumeric, dashes, underscores, and periods (for .md)
      if (!/^[a-z0-9-_\.]+$/i.test(skillName)) {
        return `Error: Invalid skillName format "${skillName}".`;
      }

      const skillsDir = path.join(process.cwd(), ".agents/skills");
      if (!fs.existsSync(skillsDir)) return "No skills directory found.";

      // 2. Resolve the file
      let targetPath = "";

      // Try exact match as a directory first
      const exactDirPath = path.join(skillsDir, skillName);
      if (fs.existsSync(exactDirPath) && fs.statSync(exactDirPath).isDirectory()) {
         targetPath = path.join(exactDirPath, "SKILL.md");
      } else {
         // It might be a sub-file like "development.md". Search all skill directories for it.
         const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
         for (const d of dirs) {
            const possiblePath = path.join(skillsDir, d.name, skillName);
            if (fs.existsSync(possiblePath) && fs.statSync(possiblePath).isFile()) {
               targetPath = possiblePath;
               break;
            }
         }
      }

      if (!targetPath || !fs.existsSync(targetPath)) {
         return `Skill or file "${skillName}" not found.`;
      }

      // 3. Path traversal defense-in-depth
      if (!targetPath.startsWith(skillsDir)) {
        return "Error: Path traversal detected.";
      }

      return fs.readFileSync(targetPath, "utf-8");
    }

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
      // Strip leading '@' in case it's a mention or username tag
      let recipient = args.recipient.trim().replace(/^@/, "");

      // Check if recipient is a custom username or phone number instead of standard key (does not start with G or C)
      if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
        const cleanedRecipient = recipient.replace(/[\s\-+]/g, "");
        const isPhone = /^[0-9]{10,18}$/.test(cleanedRecipient);
        if (isPhone) {
          const cleanPhone = cleanedRecipient;
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

          // Notification block removed per user request
          // try {
          //   await sendNotification(
          //     `${cleanPhone}@c.us`,
          //     `💸 *You've received a payment!*\n\nSomeone sent you tokens on Stellar via Stellapp Bot.\n\n` +
          //     `Your wallet address: \`${resolved.stellarPublic}\`\n\n` +
          //     `Text me *"What's my balance?"* to check your balance, or *"activate my account"* if you're on Mainnet!`
          //   );
          // } catch {
          //   // Non-critical
          // }

          console.log(`[Tools] Resolved phone number '${recipient}' to public address: ${resolved.stellarPublic}`);
          recipient = resolved.stellarPublic;
        } else {
          throw new Error(`Recipient '${recipient}' is not a valid Stellar address (G...) or phone number.`);
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

    case "bridge_stellar_to_evm": {
      const evmPrivateKey = decrypt(user.evmPrivateKey);
      const stellarSecret = decrypt(user.stellarSecret);

      // 1. Fire the burn transaction on Stellar
      const burnTxHash = await cctp.burnUSDCOnStellar(
        stellarSecret,
        args.amount,
        user.evmAddress
      );

      // 2. Start polling and minting asynchronously in the background
      runReverseBridgeBackgroundWorker(chatId, evmPrivateKey, burnTxHash, args.amount);

      return {
        success: true,
        burnTxHash,
        explorerUrl: `${config.explorerUrlStellar}${burnTxHash}`,
        message: `Outbound bridge initialized. Burn Tx: ${burnTxHash}. I will notify you here once the USDC arrives on your EVM wallet!`
      };
    }

    case "deploy_escrow_contract": {
      await sendNotification(chatId, "⏳ *Deploying Escrow Contract...*\n\nThis involves compiling the Rust smart contract to WASM and deploying it to the Stellar network. It usually takes 30-45 seconds. Please wait!");
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
      await sendNotification(chatId, "⏳ *Compiling & Deploying Custom Contract...*\n\nThis involves writing the Rust smart contract, compiling it to WASM, and deploying it to the Stellar network. It usually takes 45-60 seconds. Please wait!");
      const stellarSecret = decrypt(user.stellarSecret);
      const contractType: string = (args.contractType || "custom").toLowerCase();

      // ⭐ Use hardcoded proven templates instead of AI-generated Rust
      // This prevents hallucination errors entirely.
      let rustCode: string;
      if (contractType === "token" || contractType === "coin") {
        const name = args.name || "MyToken";
        const symbol = (args.symbol || "MTK").substring(0, 9);
        const supply = String(Math.round(parseFloat(args.initialSupply || "1000000") * Math.pow(10, parseInt(args.decimals || "7"))));
        const decimals = args.decimals || "7";
        console.log(`[Tools] Using hardcoded TOKEN template: ${name} (${symbol}), supply=${supply}, decimals=${decimals}`);
        rustCode = getTokenContractTemplate(name, symbol, supply, decimals);
      } else if (contractType === "nft") {
        const name = args.name || "MyNFT";
        const symbol = (args.symbol || "MNFT").substring(0, 9);
        const maxSupply = args.maxSupply || "10000";
        console.log(`[Tools] Using hardcoded NFT template: ${name} (${symbol}), maxSupply=${maxSupply}`);
        rustCode = getNftContractTemplate(name, symbol, maxSupply);
      } else if (contractType === "timelock" || contractType === "vesting") {
        const beneficiary = args.beneficiary || args.recipient || "";
        const unlockLedger = args.unlockLedger || args.deadline || "1000000";
        const amount = args.amount || "0";
        console.log(`[Tools] Using hardcoded TIMELOCK template: beneficiary=${beneficiary}, unlock=${unlockLedger}`);
        rustCode = getTimelockContractTemplate(beneficiary, unlockLedger, amount);
      } else if (contractType === "staking" || contractType === "stake") {
        const name = args.name || "StakingPool";
        console.log(`[Tools] Using hardcoded STAKING template: ${name}`);
        rustCode = getStakingContractTemplate(name);
      } else if (contractType === "voting" || contractType === "governance" || contractType === "vote") {
        const name = args.name || "Governance";
        const proposal = args.proposal || args.description || "Community Vote";
        console.log(`[Tools] Using hardcoded VOTING template: ${name} - ${proposal}`);
        rustCode = getVotingContractTemplate(name, proposal);
      } else if (contractType === "escrow") {
        rustCode = templates.ESCROW_TEMPLATE;
      } else if (contractType === "streaming_payment") {
        rustCode = templates.STREAMING_PAYMENT_TEMPLATE;
      } else if (contractType === "multisig") {
        rustCode = templates.MULTISIG_TEMPLATE;
      } else if (contractType === "bounty") {
        rustCode = templates.BOUNTY_TEMPLATE;
      } else if (contractType === "payment_splitter") {
        rustCode = templates.PAYMENT_SPLITTER_TEMPLATE;
      } else if (contractType === "airdrop") {
        rustCode = templates.AIRDROP_TEMPLATE;
      } else if (contractType === "swap_dex") {
        rustCode = templates.DEX_SWAP_TEMPLATE;
      } else if (contractType === "lending") {
        rustCode = templates.LENDING_TEMPLATE;
      } else {
        // For truly custom contracts, use gpt-4o as a specialized coder agent
        const customDescription = args.customDescription || "";
        if (!customDescription) throw new Error("customDescription is required for custom contracts.");
        
        console.log(`[Tools] Generating custom Rust contract using gpt-4o for description: ${customDescription}`);
        
        const openai = new OpenAI();
        const codeGenResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a senior Rust smart contract developer for Stellar Soroban (v21.7.7). Output ONLY the raw Rust source code. No markdown formatting, no backticks, no explanations. It must start with #![no_std] and compile successfully."
            },
            {
              role: "user",
              content: `Write a Soroban smart contract with the following requirements: ${customDescription}`
            }
          ]
        });

        rustCode = codeGenResponse.choices[0].message.content || "";
        
        // Cleanup any markdown blocks if the AI accidentally included them
        if (rustCode.startsWith("\`\`\`rust")) rustCode = rustCode.replace("\`\`\`rust", "");
        if (rustCode.startsWith("\`\`\`")) rustCode = rustCode.replace("\`\`\`", "");
        if (rustCode.endsWith("\`\`\`")) rustCode = rustCode.slice(0, -3);
        rustCode = rustCode.trim();

        // Safety net: if AI forgot the #![no_std] directive, inject it
        if (!rustCode.includes("#![no_std]")) {
          rustCode = "#![no_std]\n" + rustCode;
        }
        
        // Safety net: if AI forgot the imports completely, inject standard ones
        if (!rustCode.includes("use soroban_sdk")) {
          rustCode = rustCode.replace("#![no_std]", "#![no_std]\nuse soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, Vec, String, Map, Symbol, symbol_short, token};\n");
        }
      }

      // 1. Compile chosen template to WASM
      console.log(`[Tools] Starting custom contract compilation (type=${contractType})...`);
      const wasmBytes = compileRustContract(rustCode);

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

    case "deploy_privacy_pool": {
      await sendNotification(chatId, "⏳ *Deploying ZK Privacy Pool...*\n\nThis involves deploying the Zero-Knowledge verifier and the privacy pool to the Stellar network. It usually takes 30-45 seconds. Please wait!");
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
      
      const { secret, nullifier, commitment } = await zkPool.generateDeposit();
      const amountStr = args.amount;

      // Ensure formatting of commitment as a hex string of 32 bytes
      // Snarkjs numbers are large BigInt strings, so we convert them to buffer then to hex
      let commitmentHex = BigInt(commitment).toString(16);
      while(commitmentHex.length < 64) commitmentHex = "0" + commitmentHex;

      // 4. Perform deposit
      const txHash = await stellar.depositToPrivacyPool(
        stellarSecret,
        args.contractId,
        commitmentHex,
        amountStr
      );

      // 5. Generate client secret note format
      const secretNote = `stellapp-zk-v1_${args.contractId}_${amountStr}_${secret}_${nullifier}`;

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
      if (parts.length !== 5 || parts[0] !== "stellapp-zk-v1") {
        throw new Error("Invalid secret note format. Must start with 'stellapp-zk-v1_'.");
      }

      const contractId = parts[1];
      const amountStr = parts[2];
      const secret = parts[3];
      const nullifier = parts[4];

      // For the demo, we assume an empty tree. The root is computed by hashing the commitment up the tree.
      // In a real app, we'd query the off-chain DB for the Merkle path.
      // To keep the hackathon demo simple, we assume the bot provides empty paths.
      const commitment = await zkPool.recomputeCommitment(secret, nullifier);
      const pathElements = ["0", "0", "0", "0"]; // Mock paths for demo
      const pathIndices = ["0", "0", "0", "0"];
      const currentRoot = await zkPool.computeRoot(commitment, pathElements);

      // Generate the ZK proof off-chain!
      const { proof, publicSignals, nullifierHash } = await zkPool.generateWithdrawProof(
        secret,
        nullifier,
        currentRoot,
        pathElements,
        pathIndices,
        user.stellarPublic
      );

      // Withdraw using user's main wallet as the recipient
      const txHash = await stellar.withdrawFromPrivacyPool(
        stellarSecret,
        contractId,
        user.stellarPublic,
        amountStr,
        proof,
        publicSignals,
        nullifierHash
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

/**
 * Background worker to poll Circle attestation by txHash and execute mint on EVM.
 */
function runReverseBridgeBackgroundWorker(
  chatId: string,
  evmPrivateKey: string,
  burnTxHash: string,
  amount: string
) {
  Promise.resolve()
    .then(async () => {
      const sourceDomain = 27; // Stellar Domain ID
      
      // 1. Poll attestation by txHash
      const { attestationHex, messageBytesHex } = await cctp.pollForCircleAttestationByTxHash(burnTxHash, sourceDomain);
      
      // 2. Submit mint on EVM
      const mintTxHash = await evm.receiveMessageOnEVM(evmPrivateKey, messageBytesHex, attestationHex);
      
      // 3. Notify user via WhatsApp
      await sendNotification(
        chatId,
        `🎉 *Reverse Bridge Complete!* \n\nSuccessfully bridged *${amount} USDC* to your EVM wallet!\n\n🔗 *Mint Transaction:* ${config.explorerUrlBase}${mintTxHash}`
      );
    })
    .catch(async (error: any) => {
      console.error("[CCTP Reverse Background Worker] Bridging failed:", error.message);
      await sendNotification(
        chatId,
        `⚠️ *Reverse Bridge Failed!* \n\nFailed to mint your *${amount} USDC* on EVM: ${error.message}. Please contact support with burn tx hash:\n\`${burnTxHash}\``
      );
    });
}
