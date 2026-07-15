import { encrypt, decrypt, encryptForUser, decryptForUserWithMigration } from "../services/encryption";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import * as stellar from "../services/stellar";
import { getSinglePrice, getLivePrices, formatPriceMessage } from "../services/price";
import { config } from "../services/config";
import { compileRustContractAsync } from "../services/compiler";
import { prisma } from "../services/db";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { exec } from "child_process";
import * as templates from "./templates";
import * as zkPool from "../services/zk_pool";
import * as confidentialToken from "../services/confidential_token";
import { runZKWorker } from "../zk/proving/client_worker";


// ============================================================
// AI AGENT CONFIRMATION GATE HELPERS
// ============================================================
async function getPendingAction(chatId: string): Promise<any | null> {
  try {
    const record = await prisma.sessionState.findUnique({ where: { chatId } });
    if (record) {
      const state = JSON.parse(record.stateJson);
      if (state._pending_action) {
        const pending = JSON.parse(state._pending_action);
        // Expire after 5 minutes
        if (Date.now() - pending.createdAt < 5 * 60 * 1000) {
          return pending;
        }
      }
    }
  } catch {}
  return null;
}

async function savePendingAction(chatId: string, actionName: string, args: any): Promise<void> {
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

async function clearPendingAction(chatId: string): Promise<void> {
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

function getLevenshteinDistance(a: string, b: string): number {
  const tmp = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

async function isLatestMessageConfirmation(chatId: string): Promise<boolean> {
  try {
    const record = await prisma.chatHistory.findUnique({ where: { chatId } });
    if (record) {
      const messages = JSON.parse(record.messages);
      const userMessages = messages.filter((m: any) => m.role === "user");
      if (userMessages.length > 0) {
        const lastMsg = userMessages[userMessages.length - 1].content.toLowerCase().trim();

        // 1. Exact whole-message match for short/loose terms (preventing substring/word fragment matching)
        const exactMatchTerms = [
          "y", "ok", "okay", "yes", "confirm", "confrim", "confrm", 
          "yep", "yeah", "yea", "agree", "sure", "do it", "go ahead", 
          "proceed", "approve", "doit", "goahead"
        ];
        if (exactMatchTerms.includes(lastMsg)) return true;

        // 2. Whole-word match for strong confirmation terms (excluding "y", "ok", "send")
        const strongTerms = [
          "yes", "confirm", "confrim", "confrm", "approve", 
          "yep", "yeah", "yea", "agree", "sure", "proceed"
        ];
        // Tokenize by word-boundaries/whitespace/punctuation
        const words = lastMsg.split(/[\s,.\?!_#\-]+/);
        const hasStrongWord = strongTerms.some(term => words.includes(term));
        if (hasStrongWord) return true;

        // 3. Robust Levenshtein distance check on any word to capture complex confirmation typos
        const isFuzzyConfirm = words.some((w: string) => {
          if (w.length >= 4 && getLevenshteinDistance(w, "confirm") <= 1) return true;
          return false;
        });
        return isFuzzyConfirm;
      }
    }
  } catch {}
  return false;
}



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

export let sendNotification: (chatId: string, text: string) => Promise<string> = async () => {
  console.log("Notification sender not configured yet.");
  return "";
};

export let editNotification: (chatId: string, messageId: string, text: string) => Promise<void> = async () => {
  console.log("Notification editor not configured yet.");
};

export function setNotificationSender(sender: typeof sendNotification) {
  sendNotification = sender;
}

export function setNotificationEditor(editor: typeof editNotification) {
  editNotification = editor;
}

export let sendDocument: (chatId: string, filePath: string, caption?: string) => Promise<void> = async () => {
  console.log("Document sender not configured yet.");
};

export function setDocumentSender(sender: typeof sendDocument) {
  sendDocument = sender;
}

export interface UserWalletData {
  id: string;
  stellarPublic: string;
  stellarSecret: string; // Encrypted
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

  // Rate limit on-chain transaction tools to prevent nonce/sequence conflicts,
  // but skip for all read-only, database, session-state, and job scheduling tools.
  const skipRateLimit = [
    "list_skills",
    "read_skill",
    "get_balances",
    "get_wallet_address",
    "resolve_recipient",
    "save_contact",
    "get_session_state",
    "set_session_state",
    "clear_session_state",
    "check_activation",
    "schedule_recurring_swap",
    "schedule_recurring_transfer",
    "create_limit_order",
    "list_jobs",
    "cancel_job",
    "watch_contract",
    "create_alert_job",
    "get_current_price"
  ];
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

    case "save_contact": {
      const { name, phoneNumber } = args;
      
      // Upsert the contact to avoid unique constraint errors
      await prisma.contact.upsert({
        where: {
          ownerId_name: {
            ownerId: user.id,
            name: name.toLowerCase() // store in lowercase for easy matching
          }
        },
        update: {
          phoneNumber
        },
        create: {
          ownerId: user.id,
          name: name.toLowerCase(),
          phoneNumber
        }
      });

      return {
        success: true,
        message: `Successfully saved ${name} with phone number ${phoneNumber} to contacts.`
      };
    }

    case "create_alert_job": {
      const { alertType, triggerCondition, message } = args;
      if (!alertType || !triggerCondition || !message) {
        throw new Error("Missing required arguments. Need alertType, triggerCondition, and message.");
      }

      await prisma.alertJob.create({
        data: {
          chatId,
          alertType,
          triggerCondition,
          message
        }
      });

      return {
        success: true,
        message: `Successfully set up scheduled background job of type ${alertType}. I will monitor this and notify you automatically when the trigger condition is met.`
      };
    }

    case "get_current_price": {
      const rawAssets: string = args.assets || args.asset || "XLM";
      const assetList = rawAssets.split(/[,\s]+/).map((a: string) => a.trim().toUpperCase()).filter(Boolean);

      let results;
      if (assetList.length === 1) {
        results = [await getSinglePrice(assetList[0])];
      } else {
        results = await getLivePrices(assetList);
      }

      const lines = results.map(formatPriceMessage).join("\n\n");
      return {
        prices: results,
        message: lines
      };
    }

    case "watch_contract": {
      const { contractId, contractType, cliffTime, recipient } = args;
      if (!contractId || !contractType || !cliffTime) {
        throw new Error("Missing required arguments. Need contractId, contractType, and cliffTime.");
      }

      const deployDir = path.join(process.cwd(), "public", "deploys");
      if (!fs.existsSync(deployDir)) {
        fs.mkdirSync(deployDir, { recursive: true });
      }

      const docContent = `
# Smart Contract Watcher Specifications
- **Contract Type**: \`${contractType}\`
- **Deployer Public Key**: \`${user.stellarPublic}\`
- **Cliff Time**: \`${cliffTime}\`
- **Recipient Address**: \`${recipient || "None"}\`
      `;

      fs.writeFileSync(path.join(deployDir, `contract-${contractId}.md`), docContent.trim());

      return {
        success: true,
        message: `Successfully set up watcher for contract ${contractId} (Type: ${contractType}). I will watch it and notify you when the cliff passes.`
      };
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

      // 3. Path traversal defense-in-depth using canonical path checks
      const resolvedSkillsDir = path.resolve(skillsDir);
      const resolvedTargetPath = path.resolve(targetPath);
      if (!resolvedTargetPath.startsWith(resolvedSkillsDir + path.sep)) {
        return "Error: Path traversal detected.";
      }

      return fs.readFileSync(targetPath, "utf-8");
    }

    case "get_balances": {
      let isActivated = await stellar.isAccountActivated(user.stellarPublic);
      if (!isActivated && !config.isMainnet) {
        console.log(`[Tools] Automatically funding user account on Testnet during balance check: ${user.stellarPublic}`);
        const funded = await stellar.fundStellarAccount(user.stellarPublic);
        if (funded) {
          try {
            await stellar.ensureUSDCTrustline(decryptForUserWithMigration(user.stellarSecret, user.id).plaintext);
          } catch (e: any) {
            console.error("[Tools] Auto-funding USDC trustline in balance check failed:", e.message);
          }
        }
      }

      const stellarBalances = await stellar.getBalances(user.stellarPublic);
      return {
        stellar: stellarBalances
      };
    }

    case "get_wallet_address": {
      return {
        stellarAddress: user.stellarPublic,
        message: `Your wallet address:\n\nStellar: ${user.stellarPublic}`
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
      let activated = await stellar.isAccountActivated(user.stellarPublic);
      if (!activated && !config.isMainnet) {
        console.log(`[Tools] Automatically funding user account on Testnet: ${user.stellarPublic}`);
        const funded = await stellar.fundStellarAccount(user.stellarPublic);
        if (funded) {
          try {
            await stellar.ensureUSDCTrustline(decryptForUserWithMigration(user.stellarSecret, user.id).plaintext);
            activated = true;
          } catch (e: any) {
            console.error("[Tools] Auto-funding USDC trustline failed:", e.message);
          }
        }
      }

      if (!activated) {
        return {
          activated: false,
          message: config.isMainnet
            ? `Your wallet (${user.stellarPublic}) has not received XLM yet. Please send at least 2 XLM to that address on Mainnet to activate it, then try again.`
            : `Your Testnet wallet (${user.stellarPublic}) could not be funded automatically. Friendbot might be busy. Please try again in a moment.`
        };
      }

      // Account has XLM — ensure USDC trustline is established
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
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
          : `✅ Your account is activated (XLM received), but USDC trustline setup failed. Please try again to establish it.`
      };
    }

    case "switch_network": {
      const newMode = args.network.toUpperCase();
      if (newMode !== "MAINNET" && newMode !== "TESTNET") {
        throw new Error("Invalid network mode. Must be 'MAINNET' or 'TESTNET'.");
      }

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

      return {
        success: true,
        network: newMode,
        message: `Network successfully switched to ${newMode}. Your chat history has been cleared to prevent balance and contract context mismatch on the new network.`
      };
    }

    case "resolve_recipient": {
      let recipient = args.recipient.trim();
      if (recipient.startsWith("@")) recipient = recipient.substring(1);

      // 0. If recipient is a federated address (contains *), resolve it using DB or Stellar SDK FederationServer
      if (recipient.includes("*")) {
        const parts = recipient.split("*");
        const username = parts[0].toLowerCase();
        const domain = parts[1].toLowerCase();
        
        // Try local DB lookup first
        if (domain.includes("stellapp")) {
          const localUser = await prisma.user.findFirst({ where: { username } });
          if (localUser && localUser.stellarPublic) {
            return `Recipient resolved successfully.\nStellar Address: ${localUser.stellarPublic}\nStatus: Active`;
          }
        }
        
        // Fallback to standard Stellar SDK Federation client lookup
        try {
          const { FederationServer } = require("@stellar/stellar-sdk");
          const resolved = await FederationServer.resolve(recipient);
          if (resolved && resolved.account_id) {
            return `Recipient resolved successfully.\nStellar Address: ${resolved.account_id}`;
          }
        } catch (e: any) {
          console.error("[Federation] Failed to resolve address:", recipient, e.message);
          return `Error: Failed to resolve Stellar federated address "${recipient}".`;
        }
      }

      // 1. Resolve contact name to phone number/address if it's not a phone number or Stellar key
      if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
        const cleanedRecipient = recipient.replace(/[\s\-+]/g, "");
        const isPhone = /^[0-9]{10,18}$/.test(cleanedRecipient);
        
        if (!isPhone) {
          const contact = await prisma.contact.findFirst({
            where: {
              ownerId: user.id,
              name: { equals: recipient.toLowerCase() }
            }
          });
          if (contact) {
            recipient = contact.phoneNumber;
          } else {
            const allContacts = await prisma.contact.findMany({ where: { ownerId: user.id } });
            const matched = allContacts.find(c => 
              c.name.includes(recipient.toLowerCase()) || 
              recipient.toLowerCase().includes(c.name)
            );
            if (matched) {
              recipient = matched.phoneNumber;
            } else {
              return `Error: Contact "${recipient}" was not found in your address book.`;
            }
          }
        }
      }

      if (recipient.startsWith("G") || recipient.startsWith("C")) {
        return `Recipient resolved successfully.\nStellar Address: ${recipient}`;
      }

      const cleanedRecipient = recipient.replace(/[\s\-+]/g, "");
      const isPhone = /^[0-9]{10,18}$/.test(cleanedRecipient);
      
      if (isPhone) {
        const cleanPhone = cleanedRecipient;
        let resolved = await prisma.user.findFirst({
          where: {
            OR: [
              { phoneNumber: cleanPhone },
              { chatId: { endsWith: `${cleanPhone}@c.us` } }
            ]
          }
        });

        // Also check if cleanPhone is itself a suffix of an existing longer number
        if (!resolved) {
          const allUsers = await prisma.user.findMany();
          resolved = allUsers.find(u => {
            const num = u.phoneNumber || (u.chatId.endsWith("@c.us") ? u.chatId.replace("@c.us", "") : "");
            return num.endsWith(cleanPhone) || cleanPhone.endsWith(num);
          }) ?? null;
        }

        if (!resolved || !resolved.onboarded) {
          return `Recipient ${recipient} is not registered on Stellapp yet. They must join and create a wallet first.`;
        }
        
        return `Recipient resolved successfully.\nStellar Address: ${resolved.stellarPublic}\nStatus: Active`;
      } else {
        return `Recipient ${recipient} is not a valid phone number or address format.`;
      }
    }

    case "set_session_state": {
      const key = args.key;
      const value = args.value;
      if (key && key.startsWith("_")) {
        throw new Error(`Session key "${key}" is reserved for internal use.`);
      }
      const record = await prisma.sessionState.findUnique({ where: { chatId } });
      let state: Record<string, string> = {};
      if (record) {
        state = JSON.parse(record.stateJson);
      }
      state[key] = value;
      await prisma.sessionState.upsert({
        where: { chatId },
        create: { chatId, stateJson: JSON.stringify(state) },
        update: { stateJson: JSON.stringify(state) }
      });
      return `Successfully saved session parameter: ${key} = ${value}`;
    }

    case "get_session_state": {
      const key = args.key;
      const record = await prisma.sessionState.findUnique({ where: { chatId } });
      if (!record) return `No session state found.`;
      const state: Record<string, string> = JSON.parse(record.stateJson);
      return state[key] !== undefined ? state[key] : `Key "${key}" not found in session state.`;
    }

    case "send_stellar": {
      // 1. Enforce per-transaction spend caps
      const amountNum = parseFloat(args.amount);
      const isUSDC = args.asset === "USDC";
      const limit = isUSDC ? 1000 : 5000;
      if (amountNum > limit) {
        throw new Error(`SECURITY LIMIT: Transaction amount of ${args.amount} ${args.asset} exceeds the single-transaction spend cap of ${limit} ${args.asset}. Please split it into smaller amounts.`);
      }

      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      // Strip leading '@' in case it's a mention or username tag
      let recipient = args.recipient.trim().replace(/^@/, "");

      let isGhostOnboardedOnMainnet = false;
      let ghostSecret = "";
      
      let resolvedUser = null;

      // Step 0: Contact name lookup — if recipient is not a G/C address or phone number,
      // treat it as a contact name and look up the phone number from the DB.
      if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
        const cleanedForPhone = recipient.replace(/[\s\-+]/g, "");
        const isPhone = /^[0-9]{10,18}$/.test(cleanedForPhone);
        
        if (!isPhone) {
          // Check if this is a registered custom username or federated address (e.g. "bob*stellapp.com")
          if (recipient.includes("*")) {
            const parts = recipient.split("*");
            const username = parts[0].toLowerCase();
            const domain = parts[1].toLowerCase();
            
            // Try local DB lookup first
            if (domain.includes("stellapp")) {
              const localUser = await prisma.user.findFirst({ where: { username } });
              if (localUser && localUser.stellarPublic) {
                recipient = localUser.stellarPublic;
                resolvedUser = localUser;
              }
            }
            
            // If still unresolved, try standard SDK Federation client lookup
            if (!resolvedUser || recipient.includes("*")) {
              try {
                const { FederationServer } = require("@stellar/stellar-sdk");
                const resolved = await FederationServer.resolve(recipient);
                if (resolved && resolved.account_id) {
                  recipient = resolved.account_id;
                } else {
                  throw new Error("Could not resolve account ID");
                }
              } catch (e: any) {
                console.error("[Federation] Failed to resolve address in send_stellar:", recipient, e.message);
                throw new Error(`Failed to resolve Stellar federated address "${recipient}".`);
              }
            }
          } else {
            // Check if this is a registered custom username locally
            const registeredUser = await prisma.user.findFirst({
              where: { username: recipient.toLowerCase() }
            });

            if (registeredUser) {
              console.log(`[Tools] Resolved custom username "${recipient}" to public address: ${registeredUser.stellarPublic}`);
              recipient = registeredUser.stellarPublic;
              resolvedUser = registeredUser;
            } else {
            // It's a name — look up in contacts table (case-insensitive)
            const contact = await prisma.contact.findFirst({
              where: {
                ownerId: user.id,
                name: { equals: recipient.toLowerCase() }
              }
            });
            
            // Fuzzy fallback: partial name match
            if (!contact) {
              const allContacts = await prisma.contact.findMany({ where: { ownerId: user.id } });
              const matched = allContacts.find(c => 
                c.name.includes(recipient.toLowerCase()) || 
                recipient.toLowerCase().includes(c.name)
              );
              if (matched) {
                console.log(`[Tools] Resolved contact name "${recipient}" -> phone ${matched.phoneNumber}`);
                recipient = matched.phoneNumber;
              } else {
                throw new Error(`Contact or Username "${recipient}" not found. Please save their number in contacts or specify a registered username/phone number.`);
              }
            } else {
              console.log(`[Tools] Resolved contact name "${recipient}" -> phone ${contact.phoneNumber}`);
              recipient = contact.phoneNumber;
            }
          }
        }
      }
    }

      // Check if recipient is a custom username or phone number instead of standard key (does not start with G or C)
      if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
        const cleanedRecipient = recipient.replace(/[\s\-+]/g, "");
        const isPhone = /^[0-9]{10,18}$/.test(cleanedRecipient);
        if (isPhone) {
          const cleanPhone = cleanedRecipient;
          console.log(`[Tools] Recipient is a phone number. Resolving: ${cleanPhone}`);

          
          resolvedUser = await prisma.user.findFirst({
            where: {
              OR: [
                { phoneNumber: cleanPhone },
                { chatId: { endsWith: `${cleanPhone}@c.us` } }
              ]
            }
          });

          // Also check reverse: maybe cleanPhone is a suffix of an existing longer number
          if (!resolvedUser) {
            const allPhoneUsers = await prisma.user.findMany();
            resolvedUser = allPhoneUsers.find(u => {
              const num = u.phoneNumber || (u.chatId.endsWith("@c.us") ? u.chatId.replace("@c.us", "") : "");
              return num.endsWith(cleanPhone) || cleanPhone.endsWith(num);
            }) ?? null;
          }

          if (!resolvedUser || !resolvedUser.onboarded) {
            throw new Error(`Recipient '${recipient}' is not registered on Stellapp. They must join and create a wallet first.`);
          }

          console.log(`[Tools] Resolved phone number '${recipient}' to public address: ${resolvedUser.stellarPublic}`);
          recipient = resolvedUser.stellarPublic;
        } else {
          throw new Error(`Recipient '${recipient}' is not a valid Stellar address (G...) or phone number.`);
        }
      } else if (recipient.startsWith("G")) {
        // If it is a G address, check if it belongs to one of our users (for ghost onboarding)
        resolvedUser = await prisma.user.findFirst({
          where: {
            stellarPublic: recipient
          }
        });
      }

      // 2. Enforce Confirmation Gate — save with resolved address so the intent-router handler can use it
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "send_stellar" &&
        pending.args.resolvedAddr === recipient &&
        pending.args.amount === args.amount &&
        pending.args.asset === args.asset;

      if (!pending || !argsMatch || !isConfirmed) {
        await savePendingAction(chatId, "send_stellar", {
          recipient: args.recipient, // original human-readable name/phone
          resolvedAddr: recipient,   // resolved G address — used by intent-router confirm handler
          amount: args.amount,
          asset: args.asset
        });
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm that they want to send ${args.amount} ${args.asset} to ${args.recipient} (Address: ${recipient}). Instruct them to reply 'yes' or 'confirm' to execute this transaction.`;
      }

      // Clear pending action upon approval
      await clearPendingAction(chatId);

      // 4. Fund Stellar account if it is not activated on the ledger AND it is one of our managed users
      if (resolvedUser) {
        const isActivated = await stellar.isAccountActivated(resolvedUser.stellarPublic);
        if (!isActivated) {
          if (!config.isMainnet) {
            console.log(`[Tools] Funding pre-created account on testnet: ${resolvedUser.stellarPublic}`);
            await stellar.fundStellarAccount(resolvedUser.stellarPublic);
            console.log(`[Tools] Establishing USDC trustline for pre-created account...`);
            await stellar.ensureUSDCTrustline(decryptForUserWithMigration(resolvedUser.stellarSecret, resolvedUser.id).plaintext);
          } else {
            isGhostOnboardedOnMainnet = true;
            ghostSecret = decryptForUserWithMigration(resolvedUser.stellarSecret, resolvedUser.id).plaintext;
          }
        }
      }

      let txHash = "";

      if (isGhostOnboardedOnMainnet) {
        // Mainnet Ghost-Onboarding: Sender atomically pays 2.5 XLM to create the account, 
        // establishes the trustline (if USDC), and sends the tokens all in one tx.
        console.log(`[Tools] Initiating Atomic Sponsorship on Mainnet for ${recipient}`);
        txHash = await stellar.atomicSponsorAndSend(
          stellarSecret,
          ghostSecret,
          args.amount,
          isUSDC
        );
      } else {
        // Standard payment flow
        if (isUSDC) {
          // Verify recipient has USDC trustline
          const hasTrust = await stellar.checkRecipientUSDCTrustline(recipient);
          if (!hasTrust) {
            throw new Error(
              `Recipient address ${recipient} does not have a USDC trustline. Ask them to establish a trustline for USDC before sending.`
            );
          }
        }

        txHash = await stellar.sendStellarToken(
          stellarSecret,
          recipient,
          args.amount,
          isUSDC
        );
      }

      // Notify recipient if they are a registered Stellapp user
      if (recipient !== user.stellarPublic) {
        try {
          const notifRecipient = await prisma.user.findFirst({ where: { stellarPublic: recipient } });
          if (notifRecipient) {
            const balances = await stellar.getBalances(notifRecipient.stellarPublic).catch(() => null);
            const balText = balances ? `\n\n💰 *New Balances:*\n• XLM: ${balances.xlm}\n• USDC: ${balances.usdc}` : "";
            await sendNotification(
              notifRecipient.chatId,
              `📩 *Payment Received!* 💸\n\nYou received *${args.amount} ${args.asset}* from a Stellapp user.${balText}\n\n🔗 ${config.explorerUrlStellar}${txHash}`
            );
          }
        } catch (notifErr: any) {
          console.error("[send_stellar] Failed to notify recipient:", notifErr.message);
        }
      }

      return {
        success: true,
        recipient,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`
      };
    }

    case "swap_stellar": {
      // Validate amount
      const swapAmountNum = parseFloat(args.amount);
      if (isNaN(swapAmountNum) || swapAmountNum <= 0) {
        throw new Error(`Invalid swap amount: "${args.amount}". Please provide a positive number.`);
      }

      // Confirmation Gate
      const swapPending = await getPendingAction(chatId);
      const swapConfirmed = await isLatestMessageConfirmation(chatId);
      const swapArgsMatch = swapPending &&
        swapPending.name === "swap_stellar" &&
        swapPending.args.amount === args.amount &&
        swapPending.args.direction === args.direction;

      if (!swapPending || !swapArgsMatch || !swapConfirmed) {
        await savePendingAction(chatId, "swap_stellar", args);
        const readableDir = args.direction === "XLM_TO_USDC" ? "XLM → USDC" : "USDC → XLM";
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm they want to swap ${args.amount} ${readableDir}. Instruct them to reply 'yes' or 'confirm' to execute this swap.`;
      }

      await clearPendingAction(chatId);
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const txHash = await stellar.swapTokens(stellarSecret, args.amount, args.direction);

      return {
        success: true,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`
      };
    }

    case "schedule_recurring_swap": {
      const amountNum = parseFloat(args.amountPerSwap);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error("Invalid swap amount. Please provide a positive number.");
      }

      let intervalSeconds = parseInt(args.intervalSeconds, 10);
      if (isNaN(intervalSeconds) || intervalSeconds < 10) {
        intervalSeconds = 10; // Enforce minimum 10 seconds to prevent nonce/sequence conflicts
      }

      // Confirmation Gate
      const pending = await getPendingAction(chatId);
      const confirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending &&
        pending.name === "schedule_recurring_swap" &&
        pending.args.amountPerSwap === args.amountPerSwap &&
        pending.args.fromAsset === args.fromAsset &&
        pending.args.toAsset === args.toAsset &&
        pending.args.totalSwaps === args.totalSwaps;

      if (!pending || !argsMatch || !confirmed) {
        await savePendingAction(chatId, "schedule_recurring_swap", {
          ...args,
          intervalSeconds: intervalSeconds.toString()
        });
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm they want to schedule a recurring swap of ${args.amountPerSwap} ${args.fromAsset} → ${args.toAsset}, running ${args.totalSwaps} times, every ${intervalSeconds} seconds. Instruct them to reply 'yes' or 'confirm' to schedule.`;
      }

      await clearPendingAction(chatId);

      // Send initial status message to WhatsApp and capture its ID
      let statusMessageId: string | null = null;
      try {
        statusMessageId = await sendNotification(chatId, `⏳ *DCA Swap Scheduled* \n\nStarting background execution... (Progress will be updated live in this message)`);
      } catch (err) {
        console.error("Failed to send initial background swap status message:", err);
      }

      const totalSwapsVal = parseInt(args.totalSwaps, 10);
      const isOneTimeScheduled = totalSwapsVal === 1;

      await prisma.recurringSwapJob.create({
        data: {
          chatId,
          fromAsset: args.fromAsset,
          toAsset: args.toAsset,
          amountPerSwap: args.amountPerSwap,
          intervalSeconds,
          totalSwaps: totalSwapsVal,
          lastExecutedAt: isOneTimeScheduled ? new Date() : new Date(0), // One-time scheduled tasks run after delay; DCA runs first step immediately
          statusMessageId,
        }
      });

      return `Successfully scheduled background swap: ${args.amountPerSwap} ${args.fromAsset} → ${args.toAsset}, running ${args.totalSwaps} times, every ${intervalSeconds} seconds. Progress updates will be updated live in the chat.`;
    }

    case "schedule_recurring_transfer": {
      const amountNum = parseFloat(args.amountPerTransfer);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error("Invalid transfer amount. Please provide a positive number.");
      }

      let intervalSeconds = parseInt(args.intervalSeconds, 10);
      if (isNaN(intervalSeconds) || intervalSeconds < 10) {
        intervalSeconds = 10; // Enforce minimum 10 seconds to prevent nonce/sequence conflicts
      }

      // Resolve recipient to a Stellar G-address
      let recipient = args.recipient.trim().replace(/^@/, "");
      let resolvedAddr = "";
      let recipientName = "";

      if (recipient.startsWith("G") || recipient.startsWith("C")) {
        resolvedAddr = recipient;
      } else {
        const cleanedForPhone = recipient.replace(/[\s\-+]/g, "");
        const isPhone = /^[0-9]{10,18}$/.test(cleanedForPhone);
        
        if (!isPhone) {
          // Check username
          let targetUsername = recipient.toLowerCase();
          if (targetUsername.includes("*")) {
            targetUsername = targetUsername.split("*")[0];
          }
          const registeredUser = await prisma.user.findFirst({
            where: { username: targetUsername }
          });
          if (registeredUser) {
            resolvedAddr = registeredUser.stellarPublic;
            recipientName = registeredUser.username || "";
          } else {
            // Check contacts
            const contact = await prisma.contact.findFirst({
              where: {
                ownerId: user.id,
                name: { equals: recipient.toLowerCase() }
              }
            });
            if (contact) {
              recipient = contact.phoneNumber;
              recipientName = contact.name;
            } else {
              const allContacts = await prisma.contact.findMany({ where: { ownerId: user.id } });
              const matched = allContacts.find(c => 
                c.name.includes(recipient.toLowerCase()) || 
                recipient.toLowerCase().includes(c.name)
              );
              if (matched) {
                recipient = matched.phoneNumber;
                recipientName = matched.name;
              } else {
                throw new Error(`Contact or Username "${recipient}" not found. Please save their number in contacts or specify a registered username/phone number.`);
              }
            }
          }
        }

        if (resolvedAddr === "") {
          // If resolved to a phone number, lookup user
          const cleanedPhone = recipient.replace(/[\s\-+]/g, "");
          let resolved = await prisma.user.findFirst({
            where: {
              OR: [
                { phoneNumber: cleanedPhone },
                { chatId: { endsWith: `${cleanedPhone}@c.us` } }
              ]
            }
          });
          if (!resolved) {
            const allUsers = await prisma.user.findMany();
            resolved = allUsers.find(u => {
              const num = u.phoneNumber || (u.chatId.endsWith("@c.us") ? u.chatId.replace("@c.us", "") : "");
              return num.endsWith(cleanedPhone) || cleanedPhone.endsWith(num);
            }) ?? null;
          }
          if (resolved && resolved.onboarded) {
            resolvedAddr = resolved.stellarPublic;
          } else {
            throw new Error(`Recipient ${recipient} is not registered on Stellapp yet.`);
          }
        }
      }

      const label = recipientName || resolvedAddr.slice(0, 8) + "...";

      // Confirmation Gate
      const pending = await getPendingAction(chatId);
      const confirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending &&
        pending.name === "schedule_recurring_transfer" &&
        pending.args.recipient === args.recipient &&
        pending.args.amountPerTransfer === args.amountPerTransfer &&
        pending.args.assetCode === args.assetCode &&
        pending.args.totalTransfers === args.totalTransfers;

      if (!pending || !argsMatch || !confirmed) {
        await savePendingAction(chatId, "schedule_recurring_transfer", {
          ...args,
          intervalSeconds: intervalSeconds.toString()
        });
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm they want to schedule a recurring allowance of ${args.amountPerTransfer} ${args.assetCode} to ${label}, running ${args.totalTransfers} times, every ${intervalSeconds} seconds. Instruct them to reply 'yes' or 'confirm' to schedule.`;
      }

      await clearPendingAction(chatId);

      // Send initial status message to WhatsApp and capture its ID
      let statusMessageId: string | null = null;
      try {
        statusMessageId = await sendNotification(chatId, `⏳ *Allowance Scheduled* \n\nStarting background execution... (Progress will be updated live in this message)`);
      } catch (err) {
        console.error("Failed to send initial background allowance status message:", err);
      }

      const totalTransfersVal = parseInt(args.totalTransfers, 10);
      const isOneTimeScheduled = totalTransfersVal === 1;

      await prisma.recurringTransferJob.create({
        data: {
          chatId,
          recipientAddr: resolvedAddr,
          recipientName: recipientName || recipient,
          amountPerTransfer: args.amountPerTransfer,
          assetCode: args.assetCode,
          intervalSeconds,
          totalTransfers: totalTransfersVal,
          lastExecutedAt: isOneTimeScheduled ? new Date() : new Date(0), // One-time scheduled tasks run after delay; Allowance runs first step immediately
          statusMessageId,
        }
      });

      return `Successfully scheduled background allowance: ${args.amountPerTransfer} ${args.assetCode} to ${label}, running ${args.totalTransfers} times, every ${intervalSeconds} seconds. Progress updates will be updated live in the chat.`;
    }

    case "create_limit_order": {
      const amountNum = parseFloat(args.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error("Invalid swap amount. Please provide a positive number.");
      }
      const triggerPriceNum = parseFloat(args.triggerPrice);
      if (isNaN(triggerPriceNum) || triggerPriceNum <= 0) {
        throw new Error("Invalid trigger price. Please provide a positive number.");
      }

      await prisma.limitOrderJob.create({
        data: {
          chatId,
          fromAsset: args.fromAsset,
          toAsset: args.toAsset,
          amount: args.amount,
          triggerPrice: args.triggerPrice,
          condition: args.condition,
          isActive: true
        }
      });

      const conditionLabel = args.condition === "LESS_THAN_OR_EQUAL" ? "<=" : ">=";
      return `Successfully scheduled Limit Order: Swap ${args.amount} ${args.fromAsset} → ${args.toAsset} when price reaches ${conditionLabel} ${args.triggerPrice} USDC/XLM.`;
    }

    case "deploy_escrow_contract": {
      await sendNotification(chatId, "⏳ *Deploying Escrow Contract...*\n\nThis involves compiling the Rust smart contract to WASM and deploying it to the Stellar network. It usually takes 30-45 seconds. Please wait!");
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
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
      // Confirmation Gate — releasing escrow is irreversible
      const relPending = await getPendingAction(chatId);
      const relConfirmed = await isLatestMessageConfirmation(chatId);
      const relArgsMatch = relPending &&
        relPending.name === "release_escrow" &&
        relPending.args.contractId === args.contractId;

      if (!relPending || !relArgsMatch || !relConfirmed) {
        await savePendingAction(chatId, "release_escrow", args);
        return `CONFIRMATION_REQUIRED: Releasing escrow contract ${args.contractId} will send the locked funds to the recipient — this is irreversible. You must ask the user to explicitly confirm by replying 'yes' or 'confirm'.`;
      }

      await clearPendingAction(chatId);
      const relSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const relTxHash = await stellar.releaseEscrowContract(relSecret, args.contractId);

      return {
        success: true,
        contractId: args.contractId,
        txHash: relTxHash,
        explorerUrl: `${config.explorerUrlStellar}${relTxHash}`
      };
    }

    case "refund_escrow": {
      // Confirmation Gate — refunding escrow is irreversible
      const refPending = await getPendingAction(chatId);
      const refConfirmed = await isLatestMessageConfirmation(chatId);
      const refArgsMatch = refPending &&
        refPending.name === "refund_escrow" &&
        refPending.args.contractId === args.contractId;

      if (!refPending || !refArgsMatch || !refConfirmed) {
        await savePendingAction(chatId, "refund_escrow", args);
        return `CONFIRMATION_REQUIRED: Refunding escrow contract ${args.contractId} will return the locked funds to the sender — this is irreversible. You must ask the user to explicitly confirm by replying 'yes' or 'confirm'.`;
      }

      await clearPendingAction(chatId);
      const refSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const refTxHash = await stellar.refundEscrowContract(refSecret, args.contractId);

      return {
        success: true,
        contractId: args.contractId,
        txHash: refTxHash,
        explorerUrl: `${config.explorerUrlStellar}${refTxHash}`
      };
    }

    case "deploy_custom_contract": {
      // Enforce Confirmation Gate
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "deploy_custom_contract" &&
        pending.args.contractType === args.contractType &&
        (args.contractType !== "custom" || pending.args.customDescription === args.customDescription);

      if (!pending || !argsMatch) {
        if (isConfirmed) {
          return "TRANSACTION_ALREADY_PROCESSED: This contract deployment has already been initiated or processed. No duplicate deployment was triggered.";
        }
        await savePendingAction(chatId, "deploy_custom_contract", args);
        const actionDesc = args.contractType === "custom" 
          ? `deploy a custom smart contract: "${args.customDescription}"`
          : `deploy a standard ${args.contractType.toUpperCase()} smart contract`;
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm that they want to ${actionDesc}. Instruct them to reply 'yes' or 'confirm' to execute this deployment.`;
      }

      // Clear pending action upon approval
      await clearPendingAction(chatId);

      const statusMsgId = await sendNotification(chatId, "⏳ *[1/3] Generating Rust contract...*\n\nGenerating your custom Soroban Rust contract code using the Responses API + Stellar Vector Store. Please wait!");
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const contractType: string = (args.contractType || "custom").toLowerCase();

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
        const customDescription = args.customDescription || "";
        if (!customDescription) throw new Error("customDescription is required for custom contracts.");
        
        console.log(`[Tools] Generating custom Rust contract using specialized coder for description: ${customDescription}`);
        
        const openai = new OpenAI();
        const toolsParam: any[] = [];
        if (config.openaiVectorStoreId) {
          toolsParam.push({
            type: "file_search",
          vector_store_ids: [config.openaiVectorStoreId]
          });
        }
        const codeGenResponse = await (openai as any).responses.create({
          model: config.openaiModel,
          input: [
            {
              role: "system",
              content: "You are a senior Rust smart contract developer for Stellar Soroban (v21.7.7). Output ONLY the raw Rust source code. No markdown formatting, no backticks, no explanations. It must start with #![no_std] and compile successfully. VERY IMPORTANT RULES:\n" +
                "1. Use `soroban_sdk::Vec::new(&env)` instead of `vec![]` and use `vec.push_back(val)` instead of `vec.push(val)`.\n" +
                "2. `symbol_short!(\"...\")` ONLY supports strings up to 9 characters! For symbols longer than 9 characters, you MUST use `Symbol::new(&env, \"longer_string\")` instead.\n" +
                "3. `soroban_sdk::ledger::now` does not exist! Get current time via `env.ledger().timestamp()` which returns a `u64`. Do NOT call `.get_bytes()` on it. If you need it as bytes, use `Bytes::from_array(&env, &timestamp.to_be_bytes())`.\n" +
                "4. Always use `soroban_sdk::Address` for addresses, never `symbol::address` or `Address::from_str`.\n" +
                "5. Panic using `panic!(\"msg\")`, do not use `panic_with_error` unless defined.\n" +
                "6. NEVER use `env.storage().get()` or `env.storage().set()`. You MUST specify the storage type: `env.storage().instance().set(&key, &val)` or `env.storage().persistent().get(&key)`.\n" +
                "7. For contractimpl traits, do NOT name your struct the same as a trait.\n" +
                "8. NEVER use `env.invoker()`. To authorize, pass an `Address` as a parameter and call `address.require_auth()`.\n" +
                "9. `Vec::len()` and `Vec::get(...)` in Soroban SDK return/accept `u32`, NOT `usize`. Cast appropriately (e.g. `index as u32` or `len() as usize`)."
            },
            {
              role: "user",
              content: `Write a Soroban smart contract with the following requirements: ${customDescription}`
            }
          ],
          tools: toolsParam
        });

        rustCode = codeGenResponse.output_text || "";
        await editNotification(chatId, statusMsgId, "⏳ *[2/3] Compiling Rust contract (Attempt 1/3)...*\n\nRunning Soroban contract build locally to compile your contract into WebAssembly bytecode.");
        
        if (rustCode.startsWith("```rust")) rustCode = rustCode.replace("```rust", "");
        if (rustCode.startsWith("```")) rustCode = rustCode.replace("```", "");
        if (rustCode.endsWith("```")) rustCode = rustCode.slice(0, -3);
        rustCode = rustCode.trim();

        if (!rustCode.includes("#![no_std]")) {
          rustCode = "#![no_std]\n" + rustCode;
        }
        
        if (!rustCode.includes("use soroban_sdk")) {
          rustCode = rustCode.replace("#![no_std]", "#![no_std]\nuse soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, Vec, String, Map, Symbol, symbol_short, token};\n");
        }
      }

      // Compile with self-healing compile-error loop (up to 3 attempts)
      let wasmBytes: Buffer | null = null;
      let compilationError = "";
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[Tools] Compilation attempt ${attempt}/3...`);
          if (attempt > 1) {
            await editNotification(chatId, statusMsgId, `⏳ *[2/3] Compiling Rust contract (Attempt ${attempt}/3)...*\n\nRunning local build with the healed contract code.`);
          }
          wasmBytes = await compileRustContractAsync(rustCode);
          break;
        } catch (err: any) {
          compilationError = err.message;
          console.error(`[Tools] Attempt ${attempt} compilation failed:`, compilationError);
          
          if (attempt === 3) break;
          
          console.log(`[Tools] Healing compilation errors (attempt ${attempt + 1})...`);
          await editNotification(chatId, statusMsgId, `⏳ *[Healing] Fixing compilation errors (Attempt ${attempt + 1}/3)...*\n\nCompiler errors detected! Querying Responses API + Vector Store to resolve issues and rewrite the Rust contract.`);
          const openai = new OpenAI();
          const toolsParam: any[] = [];
          if (config.openaiVectorStoreId) {
            toolsParam.push({
              type: "file_search",
              vector_store_ids: [config.openaiVectorStoreId]
            });
          }
          const fixResponse = await (openai as any).responses.create({
            model: config.openaiModel,
            input: [
              {
                role: "system",
                content: "You are a senior Rust smart contract developer for Stellar Soroban (v21.7.7). You will be given a Soroban contract that failed to compile, along with the Cargo compiler error message. Fix the errors and return ONLY the corrected, clean, raw Rust code. No markdown code blocks, no backticks, no markdown formatting, no explanations. It must start with #![no_std]."
              },
              {
                role: "user",
                content: `Failed Rust Code:\n\`\`\`rust\n${rustCode}\n\`\`\`\n\nCargo Compiler Error:\n${compilationError}\n\nFix the compilation errors and output the complete corrected Rust code.`
              }
            ],
            tools: toolsParam
          });
          
          let fixedCode = fixResponse.output_text || "";
          if (fixedCode.startsWith("```rust")) fixedCode = fixedCode.replace("```rust", "");
          if (fixedCode.startsWith("```")) fixedCode = fixedCode.replace("```", "");
          if (fixedCode.endsWith("```")) fixedCode = fixedCode.slice(0, -3);
          fixedCode = fixedCode.trim();
          
          if (!fixedCode.includes("#![no_std]")) {
            fixedCode = "#![no_std]\n" + fixedCode;
          }
          rustCode = fixedCode;
        }
      }

      if (!wasmBytes) {
        throw new Error(`Smart contract compilation failed after 3 attempts. Errors:\n${compilationError}`);
      }

      await editNotification(chatId, statusMsgId, "⏳ *[3/3] Uploading WebAssembly bytecode on-chain...*\n\nCompilation succeeded! Uploading the bytecode to the Stellar network.");
      console.log(`[Tools] Uploading WASM bytecode on-chain...`);
      const { wasmHash, txHash: uploadTxHash } = await stellar.uploadWasm(stellarSecret, wasmBytes);
      console.log(`[Tools] Contract WASM uploaded. Hash: ${wasmHash}`);

      await editNotification(chatId, statusMsgId, "⏳ *[3/3] Deploying smart contract instance...*\n\nWASM uploaded! Instantiating the deployed contract on-chain and generating documentation.");
      console.log(`[Tools] Instantiating contract instance from WASM hash...`);
      const { contractId, txHash: instantiateTxHash } = await stellar.instantiateContract(stellarSecret, wasmHash);
      console.log(`[Tools] Deployed custom contract ID: ${contractId}`);

      // Generate deployment Markdown documentation spec
      try {
        const deployDir = path.join(process.cwd(), "public", "deploys");
        if (!fs.existsSync(deployDir)) {
          fs.mkdirSync(deployDir, { recursive: true });
        }

        const mdContent = `## 📜 Stellar Soroban Smart Contract Deployment Spec

This document contains the compilation logs, configuration, and interface specs for the smart contract deployed via Stellapp.

### 💳 Deployment Details
- **Contract Type**: ${contractType.toUpperCase()}
- **Stellar Contract ID**: \`${contractId}\`
- **WASM Hash**: \`${wasmHash}\`
- **Deployer Public Key**: \`${user.stellarPublic}\`
- **Network**: Stellar ${config.isMainnet ? "Mainnet" : "Testnet"}

### 🔗 Blockchain Explorers
- **Upload Transaction**: [Stellar Expert](${config.explorerUrlStellar}${uploadTxHash})
- **Instantiation Transaction**: [Stellar Expert](${config.explorerUrlStellar}${instantiateTxHash})
- **Contract Explorer**: [Stellar Expert](${config.explorerUrlStellarContract}${contractId})

### 🛠️ How to Interact On-Chain (CLI / SDK)
To invoke functions on this contract, use the Stellar CLI:
\`\`\`bash
# Call a read-only or authorized function
stellar contract invoke \\
  --id ${contractId} \\
  --source-account S... \\
  --network ${config.isMainnet ? "mainnet" : "testnet"} \\
  -- \\
  [method_name] \\
  --[args...]
\`\`\`

### 🦀 Generated Rust Source Code
Here is the compiler-ready Rust source code that was generated, compiled, and deployed:
\`\`\`rust
${rustCode}
\`\`\`
`;
        const filepath = path.join(deployDir, `contract-${contractId}.md`);
        fs.writeFileSync(filepath, mdContent, "utf-8");

        // Create a plain text version for native WhatsApp doc rendering compatibility
        const txtFilepath = path.join(deployDir, `contract-${contractId}-spec.txt`);
        fs.writeFileSync(txtFilepath, mdContent, "utf-8");

        // Send the document file directly to the user on WhatsApp
        await sendDocument(chatId, txtFilepath, `Stellar Smart Contract Spec: contract-${contractId.substring(0,8)}.txt`);
      } catch (err) {
        console.error("Failed to generate and send deployment documentation:", err);
      }

      const docUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/deploys/contract-${contractId}.md` 
        : `http://localhost:${process.env.PORT || 3000}/deploys/contract-${contractId}.md`;

      return {
        success: true,
        contractId,
        wasmHash,
        uploadTxHash,
        instantiateTxHash,
        explorerUrl: `${config.explorerUrlStellar}${instantiateTxHash}`,
        contractExplorerUrl: `${config.explorerUrlStellarContract}${contractId}`,
        rustCode: rustCode,
        docUrl: docUrl
      };
    }

    case "deploy_privacy_pool": {
      const assetCode = (args.assetCode || "USDC").toUpperCase();

      // Enforce Confirmation Gate
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "deploy_privacy_pool" &&
        pending.args.assetCode === assetCode;

      if (!pending || !argsMatch) {
        if (isConfirmed) {
          return "TRANSACTION_ALREADY_PROCESSED: This contract deployment has already been initiated or processed. No duplicate deployment was triggered.";
        }
        await savePendingAction(chatId, "deploy_privacy_pool", { assetCode });
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm that they want to deploy a new ZK Privacy Pool for ${assetCode}. Explain that this instantiates a new contract on the network and costs fees. Instruct them to reply 'yes' or 'confirm' to execute this deployment.`;
      }

      await sendNotification(chatId, `⏳ *Deploying ZK Privacy Pool for ${assetCode}...*\n\nThis involves deploying the Zero-Knowledge verifier and the privacy pool to the Stellar network. It usually takes 30-45 seconds. Please wait!`);
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const { contractId, txHash } = await stellar.deployPrivacyPool(stellarSecret, assetCode);

      // Save contract ID to session state for automatic fallback lookup
      try {
        const record = await prisma.sessionState.findUnique({ where: { chatId } });
        let state = record ? JSON.parse(record.stateJson) : {};
        state[`latest_pool_${assetCode}`] = contractId;
        await prisma.sessionState.upsert({
          where: { chatId },
          create: { chatId, stateJson: JSON.stringify(state) },
          update: { stateJson: JSON.stringify(state) }
        });
        console.log(`[ZK Pool] Registered deployed privacy pool ${contractId} for ${assetCode} in session state.`);
      } catch (err: any) {
        console.error("Failed to save deployed pool to session state:", err.message);
      }

      return {
        success: true,
        contractId,
        txHash,
        assetCode,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        contractExplorerUrl: `${config.explorerUrlStellarContract}${contractId}`
      };
    }

    case "deposit_private_pool": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const assetCode = (args.assetCode || "USDC").toUpperCase();
      
      let poolContractId = (args.contractId || "").trim();
      
      // Auto-lookup logic if no valid contractId is specified
      if (!poolContractId || poolContractId.startsWith("C...") || poolContractId.length < 10) {
        
        // 0. Use the authoritative production fallback pools if configured
        if (assetCode === "USDC" && process.env.DEFAULT_USDC_POOL) {
          poolContractId = process.env.DEFAULT_USDC_POOL;
          console.log(`[ZK Pool] Routed deposit to authoritative env USDC pool: ${poolContractId}`);
        } else if (assetCode === "XLM" && process.env.DEFAULT_XLM_POOL) {
          poolContractId = process.env.DEFAULT_XLM_POOL;
          console.log(`[ZK Pool] Routed deposit to authoritative env XLM pool: ${poolContractId}`);
        }
        
        // A. Check current user's session state for their recently deployed pool
        if (!poolContractId) {
          try {
            const record = await prisma.sessionState.findUnique({ where: { chatId } });
            if (record) {
              const state = JSON.parse(record.stateJson);
              if (state[`latest_pool_${assetCode}`]) {
                poolContractId = state[`latest_pool_${assetCode}`];
                console.log(`[ZK Pool] Auto-resolved pool contract ID from session: ${poolContractId}`);
              }
            }
          } catch {}
        }

        // B. Check past deposits from this user
        if (!poolContractId) {
          try {
            const latestDeposit = await prisma.privacyDeposit.findFirst({
              where: { ownerId: user.id, assetCode },
              orderBy: { createdAt: "desc" }
            });
            if (latestDeposit) {
              poolContractId = latestDeposit.contractId;
              console.log(`[ZK Pool] Auto-resolved pool contract ID from past deposits: ${poolContractId}`);
            }
          } catch {}
        }

        // C. Check if ANY user in the system has deployed a pool for this asset globally in their session
        if (!poolContractId) {
          try {
            const anySession = await prisma.sessionState.findFirst({
              where: { stateJson: { contains: `"latest_pool_${assetCode}"` } },
              orderBy: { updatedAt: "desc" }
            });
            if (anySession) {
              const state = JSON.parse(anySession.stateJson);
              if (state[`latest_pool_${assetCode}`]) {
                poolContractId = state[`latest_pool_${assetCode}`];
                console.log(`[ZK Pool] Auto-resolved pool contract ID from global sessions: ${poolContractId}`);
              }
            }
          } catch {}
        }

        // D. Check global deposits
        if (!poolContractId) {
          try {
            const anyDeposit = await prisma.privacyDeposit.findFirst({
              where: { assetCode },
              orderBy: { createdAt: "desc" }
            });
            if (anyDeposit) {
              poolContractId = anyDeposit.contractId;
              console.log(`[ZK Pool] Auto-resolved pool contract ID from global system history: ${poolContractId}`);
            }
          } catch {}
        }
      }

      if (!poolContractId) {
        throw new Error(`Stellar Privacy Pool contract ID is missing. Please deploy a pool first by saying "deploy ZK privacy pool for ${assetCode}" or specify the contract ID.`);
      }

      // Enforce Confirmation Gate
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "deposit_private_pool" &&
        pending.args.amount === args.amount &&
        pending.args.assetCode === assetCode;

      if (!pending || !argsMatch) {
        if (isConfirmed) {
          return "TRANSACTION_ALREADY_PROCESSED: This privacy pool deposit has already been initiated or processed. No duplicate deposit was triggered.";
        }
        await savePendingAction(chatId, "deposit_private_pool", {
          amount: args.amount,
          assetCode
        });
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm that they want to deposit ${args.amount} ${assetCode} into the ZK Privacy Pool. Instruct them to reply 'yes' or 'confirm' to execute this deposit.`;
      }

      // Clear pending action upon approval
      await clearPendingAction(chatId);

      const { secret, nullifier, commitment } = await zkPool.generateDeposit();
      const amountStr = args.amount;

      // Ensure formatting of commitment as a hex string of 32 bytes
      // Snarkjs numbers are large BigInt strings, so we convert them to buffer then to hex
      let commitmentHex = BigInt(commitment).toString(16);
      while(commitmentHex.length < 64) commitmentHex = "0" + commitmentHex;

      // Count existing deposits for this pool to determine the leaf index
      const existingDeposits = await prisma.privacyDeposit.count({
        where: { contractId: poolContractId }
      });
      const leafIndex = existingDeposits; // 0-based index in Merkle tree

      // Perform deposit on-chain
      const txHash = await stellar.depositToPrivacyPool(
        stellarSecret,
        poolContractId,
        commitmentHex,
        amountStr
      );

      // Save commitment to DB for Merkle path reconstruction on withdraw
      await prisma.privacyDeposit.create({
        data: {
          ownerId: user.id,
          contractId: poolContractId,
          commitmentHex,
          leafIndex,
          amount: amountStr,
          assetCode,
          spent: false
        }
      });

      // Calculate the new Merkle root and try to update it on-chain (if the user is the admin)
      try {
        const siblingIndex = leafIndex % 2 === 0 ? leafIndex + 1 : leafIndex - 1;
        const allDeposits = await prisma.privacyDeposit.findMany({
          where: { contractId: poolContractId },
          orderBy: { leafIndex: "asc" }
        });
        const sibling = allDeposits.find(d => d.leafIndex === siblingIndex);
        const siblingHex = sibling ? sibling.commitmentHex : "0";
        const pathElements = [siblingHex, "0", "0", "0"];
        const pathIndices = [String(leafIndex % 2), "0", "0", "0"];
        
        const newRoot = await zkPool.computeRoot(commitment, pathElements, pathIndices);
        const newRootHex = BigInt(newRoot).toString(16).padStart(64, "0");

        console.log(`[ZK Pool] Attempting to update Merkle root on-chain to ${newRootHex}...`);
        await stellar.invokeContractMethod(stellarSecret, poolContractId, "update_root", [
          xdr.ScVal.scvBytes(Buffer.from(newRootHex, "hex"))
        ]);
        console.log(`[ZK Pool] Merkle root updated successfully on-chain.`);
      } catch (rootErr: any) {
        console.warn(`[ZK Pool] Skip root update check (non-admin or simulation failed): ${rootErr.message}`);
      }

      // Generate client secret note format
      const secretNote = `stellapp-zk-v1_${poolContractId}_${amountStr}_${secret}_${nullifier}`;

      return {
        success: true,
        commitmentHex,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        secretNote,
        message: `Successfully deposited ${amountStr} ${assetCode} into the Privacy Pool! 🤫\n\nSave this secret note to withdraw your funds later or send it to someone else:\n\n\`${secretNote}\``
      };
    }

    case "withdraw_private_pool": {
      // Parse the secret note
      const noteStr: string = args.secretNote.trim();
      const parts = noteStr.split("_");
      if (parts.length !== 5 || parts[0] !== "stellapp-zk-v1") {
        throw new Error("Invalid secret note format. Must start with 'stellapp-zk-v1_'.");
      }

      const contractId = parts[1];
      // NOTE: We intentionally ignore parts[2] (the amount embedded in the note)
      // and will use the authoritative DB record amount after we find the deposit.
      // This prevents a user from forging a larger withdrawal by editing their note string.
      const secret = parts[3];
      const nullifier = parts[4];

      // Recompute commitment from secret + nullifier
      const commitment = await zkPool.recomputeCommitment(secret, nullifier);
      let commitmentHex = BigInt(commitment).toString(16);
      while(commitmentHex.length < 64) commitmentHex = "0" + commitmentHex;

      // Fetch all deposits for this pool from DB to reconstruct real Merkle path
      const allDeposits = await prisma.privacyDeposit.findMany({
        where: { contractId },
        orderBy: { leafIndex: "asc" }
      });

      // Find this deposit's record
      const depositRecord = allDeposits.find(d => d.commitmentHex === commitmentHex);
      if (!depositRecord) {
        throw new Error("Deposit not found in database. The secret note may be invalid or from a different instance.");
      }

      // Check if nullifier has already been spent globally
      const nullifierHashCalculated = await zkPool.poseidon1(nullifier);
      const spentDeposit = await prisma.privacyDeposit.findFirst({
        where: {
          OR: [
            { nullifierHash: nullifierHashCalculated },
            { spent: true, id: depositRecord.id }
          ]
        }
      });
      if (spentDeposit || depositRecord.spent) {
        throw new Error("This deposit note has already been withdrawn (spent nullifier). Cannot double-spend.");
      }

      // FIX #1: Use the authoritative DB amount — never trust the user-supplied note amount.
      const amountStr = depositRecord.amount;

      // Resolve recipient address first
      let recipient = (args.recipient || "").trim().replace(/^@/, "");
      if (!recipient) {
        recipient = user.stellarPublic;
      } else {
        // Resolve contact name to phone number
        if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
          const cleanedForPhone = recipient.replace(/[\s\-+]/g, "");
          const isPhone = /^[0-9]{10,18}$/.test(cleanedForPhone);
          
          if (!isPhone) {
            const contact = await prisma.contact.findFirst({
              where: {
                ownerId: user.id,
                name: { equals: recipient.toLowerCase() }
              }
            });
            
            if (!contact) {
              const allContacts = await prisma.contact.findMany({ where: { ownerId: user.id } });
              const matched = allContacts.find(c => 
                c.name.includes(recipient.toLowerCase()) || 
                recipient.toLowerCase().includes(c.name)
              );
              if (matched) {
                recipient = matched.phoneNumber;
              } else {
                throw new Error(`Contact "${recipient}" not found. Please save their number first.`);
              }
            } else {
              recipient = contact.phoneNumber;
            }
          }
        }

        // Resolve phone number to Stellar address
        if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
          const cleanedRecipient = recipient.replace(/[\s\-+]/g, "");
          const isPhone = /^[0-9]{10,18}$/.test(cleanedRecipient);
          if (isPhone) {
            const cleanPhone = cleanedRecipient;
            let resolvedUser = await prisma.user.findFirst({
              where: { chatId: { endsWith: `${cleanPhone}@c.us` } }
            });
            if (!resolvedUser) {
              const allPhoneUsers = await prisma.user.findMany({
                where: { chatId: { endsWith: "@c.us" } }
              });
              resolvedUser = allPhoneUsers.find(u => {
                const num = u.chatId.replace("@c.us", "");
                return num.endsWith(cleanPhone) || cleanPhone.endsWith(num);
              }) ?? null;
            }
            if (!resolvedUser) {
              throw new Error(`Recipient phone number ${cleanPhone} does not have an account yet.`);
            }
            recipient = resolvedUser.stellarPublic;
          } else {
            throw new Error(`Invalid recipient. Must be contact name, phone number, or G-address.`);
          }
        }
      }

      // Enforce Confirmation Gate
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "withdraw_private_pool" &&
        pending.args.secretNote === args.secretNote &&
        pending.args.recipient === args.recipient;

      if (!pending || !argsMatch) {
        if (isConfirmed) {
          return "TRANSACTION_ALREADY_PROCESSED: This privacy pool withdrawal has already been initiated or processed. No duplicate withdrawal was triggered.";
        }
        await savePendingAction(chatId, "withdraw_private_pool", {
          secretNote: args.secretNote,
          recipient: args.recipient,
          resolvedAddr: recipient
        });
        const recipientLabel = args.recipient ? `to ${args.recipient} (Address: ${recipient})` : "to your wallet";
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm that they want to withdraw their ZK Secret Note of ${amountStr} ${depositRecord.assetCode} ${recipientLabel}. Instruct them to reply 'yes' or 'confirm' to execute this withdrawal.`;
      }

      // Clear pending action upon approval
      await clearPendingAction(chatId);

      // Build Merkle path using sibling commitments
      const leafIndex = depositRecord.leafIndex;
      const siblingIndex = leafIndex % 2 === 0 ? leafIndex + 1 : leafIndex - 1;
      const sibling = allDeposits.find(d => d.leafIndex === siblingIndex);
      const siblingHex = sibling ? sibling.commitmentHex : "0";
      const pathElements = [siblingHex, "0", "0", "0"];
      const pathIndices = [String(leafIndex % 2), "0", "0", "0"];

      const currentRoot = await zkPool.computeRoot(commitment, pathElements, pathIndices);

      // FIX #2: Verify computed root matches the on-chain contract state before generating proof.
      // This prevents proof generation against a stale or mismatched Merkle root.
      try {
        const onChainRoot = await stellar.getPrivacyPoolRoot(contractId);
        if (onChainRoot && onChainRoot !== currentRoot) {
          throw new Error(`Merkle root mismatch: the pool state has changed since your deposit was recorded. Expected ${currentRoot.slice(0, 12)}..., got ${onChainRoot.slice(0, 12)}... — please retry.`);
        }
      } catch (rootCheckErr: any) {
        // Only re-throw if it's our own mismatch error, not an RPC connectivity issue
        if (rootCheckErr.message.includes("Merkle root mismatch")) throw rootCheckErr;
        console.warn(`[ZK Pool] On-chain root check skipped (RPC error): ${rootCheckErr.message}`);
      }

      // Generate the ZK proof inline to prevent background worker spawn/IPC bugs
      const { proof, publicSignals, nullifierHash } = await zkPool.generateWithdrawProof(
        secret,
        nullifier,
        currentRoot,
        pathElements,
        pathIndices,
        recipient
      );

      // Withdraw using resolved recipient
      // DECRYPT KEY ONLY AT THE SIGNING MOMENT to minimize memory lifetime
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const txHash = await stellar.withdrawFromPrivacyPool(
        stellarSecret,
        contractId,
        recipient,
        amountStr,
        proof,
        publicSignals,
        nullifierHash
      );

      // Mark the deposit as spent to prevent double-withdrawal
      await prisma.privacyDeposit.update({
        where: { id: depositRecord.id },
        data: { spent: true, nullifierHash }
      });

      // Send recipient notification if they are registered on the bot
      if (recipient !== user.stellarPublic) {
        try {
          const recipientUser = await prisma.user.findFirst({
            where: { stellarPublic: recipient }
          });
          if (recipientUser) {
            const balances = await stellar.getBalances(recipientUser.stellarPublic);
            const explorerUrl = `${config.explorerUrlStellar}${txHash}`;
            const notificationText = `📩 *Payment Received via Privacy Pool!* 🔒\n\nYou have received *${amountStr} ${depositRecord.assetCode}* directly to your wallet via a private ZK withdrawal.\n\n💰 *New Balances:* \n• XLM: ${balances.xlm}\n• USDC: ${balances.usdc}\n\n🔗 View details: ${explorerUrl}`;
            await sendNotification(recipientUser.chatId, notificationText);
          }
        } catch (notifErr: any) {
          console.error("[ZK Notification] Failed to notify recipient:", notifErr.message);
        }
      }

      return {
        success: true,
        contractId,
        amount: amountStr,
        assetCode: depositRecord.assetCode,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        message: `Successfully withdrew ${amountStr} ${depositRecord.assetCode} from the Privacy Pool! 🎉`
      };
    }

    case "confidential_register": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const assetCode = (args.asset || "XLM").toUpperCase();
      await sendNotification(chatId, `⏳ *Generating registration ZK proof for ${assetCode}...*\n\nThis involves deriving your confidential spending/viewing keys and submitting a ZK registration proof to the Stellar contract. It takes 15-20 seconds.`);
      const txHash = await confidentialToken.registerConfidential(stellarSecret, assetCode);
      return {
        success: true,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        message: `Successfully registered for ZK confidential transfers of ${assetCode}! 🎉\n\nTx: ${txHash.slice(0, 8)}...`
      };
    }

    case "confidential_register_all": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;

      // 1. Detect which assets the user actually holds (non-zero balance)
      const balances = await stellar.getBalances(user.stellarPublic);
      const assetsToRegister: string[] = [];
      if (parseFloat(balances.xlm) > 0) assetsToRegister.push("XLM");
      if (parseFloat(balances.usdc) > 0) assetsToRegister.push("USDC");

      if (assetsToRegister.length === 0) {
        return {
          success: false,
          message: `⚠️ No non-zero balances found. Fund your wallet with XLM or USDC before registering for confidential transfers.`
        };
      }

      await sendNotification(chatId, `⏳ *Registering ${assetsToRegister.join(" & ")} for ZK confidential transfers...*\n\nThis generates a ZK proof per asset and submits sequentially. Takes ~15-20s per asset.`);

      // 2. Register each asset sequentially (parallel would race on Stellar sequence numbers)
      const results: { asset: string; status: "✅ registered" | "☑️ already registered" | "❌ failed"; detail: string }[] = [];

      for (const asset of assetsToRegister) {
        try {
          const txHash = await confidentialToken.registerConfidential(stellarSecret, asset);
          results.push({ asset, status: "✅ registered", detail: `Tx: ${txHash.slice(0, 8)}...` });
        } catch (err: any) {
          const msg: string = err?.message ?? String(err);
          if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
            results.push({ asset, status: "☑️ already registered", detail: "No action needed" });
          } else {
            results.push({ asset, status: "❌ failed", detail: msg.slice(0, 80) });
          }
        }
      }

      const summary = results.map(r => `${r.status} *${r.asset}* — ${r.detail}`).join("\n");
      const allOk = results.every(r => r.status !== "❌ failed");

      return {
        success: allOk,
        results,
        message: `🔒 *Confidential Registration Complete*\n\n${summary}\n\nYou can now deposit assets into your confidential balance.`
      };
    }


    case "confidential_deposit": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const amountStr = args.amount;
      if (isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) {
        throw new Error(`Invalid deposit amount: "${amountStr}". Please provide a positive number.`);
      }
      const assetCode = (args.asset || "XLM").toUpperCase();
      await sendNotification(chatId, `⏳ *Depositing ${amountStr} ${assetCode} into ZK receiving balance...*`);
      const txHash = await confidentialToken.depositConfidential(stellarSecret, amountStr, assetCode);
      return {
        success: true,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        message: `Successfully deposited ${amountStr} ${assetCode} into your confidential receiving balance! 🤫\n\n*Note*: You must call "merge" to fold this receiving balance into your spendable balance before you can spend it.`
      };
    }

    case "confidential_merge": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const assetCode = (args.asset || "XLM").toUpperCase();
      await sendNotification(chatId, `⏳ *Merging receiving balance into spendable for ${assetCode}...*`);
      const txHash = await confidentialToken.mergeConfidential(stellarSecret, assetCode);
      return {
        success: true,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        message: `Successfully folded receiving balance of ${assetCode} into your spendable balance! 🤫`
      };
    }

    case "confidential_balance": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const assetCode = (args.asset || "XLM").toUpperCase();
      const balances = await confidentialToken.getConfidentialBalances(stellarSecret, assetCode);

      let balanceMsg: string;
      if (balances.syncGap) {
        balanceMsg =
          `*🔒 Confidential balance (${assetCode})*\n\n` +
          `• *Spendable*: _(balance exists but exact amount needs re-sync)_ ⚠️\n` +
          `• *Receiving*: 0 ${assetCode}\n\n` +
          `• *Registered*: Yes ✅\n\n` +
          `_Your funds are safe on-chain. The exact spendable amount cannot be displayed right now ` +
          `because some deposit history (older than 7 days) is no longer available via the RPC node. ` +
          `To restore full balance display, perform a new confidential transfer or withdrawal \u2014 ` +
          `this will reset your local state with a fresh on-chain event._`;
      } else {
        balanceMsg =
          `*🔒 Confidential balance (${assetCode})*\n\n` +
          `• *Spendable*: ${balances.spendable} ${assetCode}\n` +
          `• *Receiving*: ${balances.receiving} ${assetCode}\n\n` +
          `• *Registered*: ${balances.registered ? "Yes ✅" : "No ❌"}`;
      }

      return {
        success: true,
        ...balances,
        message: balanceMsg
      };
    }


    case "confidential_transfer": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const amountStr = args.amount;
      if (isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) {
        throw new Error(`Invalid transfer amount: "${amountStr}". Please provide a positive number.`);
      }
      const assetCode = (args.asset || "XLM").toUpperCase();
      let recipient = args.recipient.trim().replace(/^@/, "");

      // Resolve contact name to phone number
      if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
        const cleanedForPhone = recipient.replace(/[\s\-+]/g, "");
        const isPhone = /^[0-9]{10,18}$/.test(cleanedForPhone);
        
        if (!isPhone) {
          const contact = await prisma.contact.findFirst({
            where: {
              ownerId: user.id,
              name: { equals: recipient.toLowerCase() }
            }
          });
          
          if (!contact) {
            const allContacts = await prisma.contact.findMany({ where: { ownerId: user.id } });
            const matched = allContacts.find(c => 
              c.name.includes(recipient.toLowerCase()) || 
              recipient.toLowerCase().includes(c.name)
            );
            if (matched) {
              recipient = matched.phoneNumber;
            } else {
              throw new Error(`Contact "${recipient}" not found. Please save their number first.`);
            }
          } else {
            recipient = contact.phoneNumber;
          }
        }
      }

      // Resolve phone number to Stellar address
      if (!recipient.startsWith("G") && !recipient.startsWith("C")) {
        const cleanedRecipient = recipient.replace(/[\s\-+]/g, "");
        const isPhone = /^[0-9]{10,18}$/.test(cleanedRecipient);
        if (isPhone) {
          const cleanPhone = cleanedRecipient;
          let resolvedUser = await prisma.user.findFirst({
            where: { chatId: { endsWith: `${cleanPhone}@c.us` } }
          });
          if (!resolvedUser) {
            const allPhoneUsers = await prisma.user.findMany({
              where: { chatId: { endsWith: "@c.us" } }
            });
            resolvedUser = allPhoneUsers.find(u => {
              const num = u.chatId.replace("@c.us", "");
              return num.endsWith(cleanPhone) || cleanPhone.endsWith(num);
            }) ?? null;
          }
          if (!resolvedUser) {
            throw new Error(`Recipient phone number ${cleanPhone} does not have an account yet.`);
          }
          recipient = resolvedUser.stellarPublic;
        } else {
          throw new Error(`Invalid recipient. Must be contact name, phone number, or G-address.`);
        }
      }

      // Enforce Confirmation Gate
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "confidential_transfer" &&
        pending.args.resolvedAddr === recipient &&
        pending.args.amount === args.amount &&
        pending.args.asset === assetCode;

      if (!pending || !argsMatch) {
        if (isConfirmed) {
          return "TRANSACTION_ALREADY_PROCESSED: This confidential transfer has already been initiated or processed. No duplicate transfer was triggered.";
        }
        await savePendingAction(chatId, "confidential_transfer", {
          recipient: args.recipient,
          resolvedAddr: recipient,
          amount: args.amount,
          asset: assetCode
        });
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm that they want to send ${args.amount} ${assetCode} privately to ${args.recipient} (Address: ${recipient}). Instruct them to reply 'yes' or 'confirm' to execute this transaction.`;
      }

      // Clear pending action upon approval
      await clearPendingAction(chatId);

      await sendNotification(chatId, `⏳ *Generating ZK proof for private transfer of ${amountStr} ${assetCode}...*\n\nThis derives ephemeral ECDH keys and solves UltraHonk witnesses. It takes 15-20 seconds.`);
      const txHash = await confidentialToken.transferConfidential(stellarSecret, recipient, amountStr, assetCode);

      // Send recipient notification if they are registered on the bot
      if (recipient !== user.stellarPublic) {
        try {
          const recipientUser = await prisma.user.findFirst({
            where: { stellarPublic: recipient }
          });
          if (recipientUser) {
            const notificationText = `📩 *Confidential Payment Received!* 🔒\n\nYou have received a private transfer of *${amountStr} ${assetCode}* directly to your private receiving balance on-chain. Amount and balances are fully hidden from the public ledger.\n\n👉 Type *"merge"* to merge this into your spendable confidential balance!`;
            await sendNotification(recipientUser.chatId, notificationText);
          }
        } catch (notifErr: any) {
          console.error("[Confidential Notification] Failed to notify recipient:", notifErr.message);
        }
      }
      
      return {
        success: true,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        message: `Successfully transferred ${amountStr} ${assetCode} privately! 🔒\n\nThe transaction is finalized on-chain with hidden amounts and balances.`
      };
    }

    case "confidential_withdraw": {
      const stellarSecret = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const amountStr = args.amount;
      if (isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) {
        throw new Error(`Invalid withdrawal amount: "${amountStr}". Please provide a positive number.`);
      }
      const recipient = args.recipient;
      const assetCode = (args.asset || "XLM").toUpperCase();

      // Enforce Confirmation Gate
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "confidential_withdraw" &&
        pending.args.recipient === recipient &&
        pending.args.amount === args.amount &&
        pending.args.asset === assetCode;

      if (!pending || !argsMatch) {
        if (isConfirmed) {
          return "TRANSACTION_ALREADY_PROCESSED: This confidential withdrawal has already been initiated or processed. No duplicate withdrawal was triggered.";
        }
        await savePendingAction(chatId, "confidential_withdraw", {
          recipient,
          amount: args.amount,
          asset: assetCode
        });
        return `CONFIRMATION_REQUIRED: You must ask the user to explicitly confirm that they want to withdraw ${args.amount} ${assetCode} from their private balance to their public address ${recipient}. Instruct them to reply 'yes' or 'confirm' to execute this withdrawal.`;
      }

      // Clear pending action upon approval
      await clearPendingAction(chatId);

      await sendNotification(chatId, `⏳ *Generating ZK proof for confidential withdrawal of ${amountStr} ${assetCode}...*\n\nThis solves the UltraHonk withdraw witness. It takes 15-20 seconds.`);
      const txHash = await confidentialToken.withdrawConfidential(stellarSecret, recipient, amountStr, assetCode);

      return {
        success: true,
        txHash,
        explorerUrl: `${config.explorerUrlStellar}${txHash}`,
        message: `Successfully withdrew ${amountStr} ${assetCode} confidentially to public address ${recipient}! 🔓\n\nTx: ${txHash.slice(0, 8)}...`
      };
    }

    case "list_jobs": {
      const swaps = await prisma.recurringSwapJob.findMany({ where: { chatId, isActive: true } });
      const transfers = await prisma.recurringTransferJob.findMany({ where: { chatId, isActive: true } });
      const limits = await prisma.limitOrderJob.findMany({ where: { chatId, isActive: true } });

      if (swaps.length === 0 && transfers.length === 0 && limits.length === 0) {
        return "You have no active background recurring or price-limit jobs running.";
      }

      let response = "📋 *Your Active Background Jobs:*\n\n";

      if (swaps.length > 0) {
        response += "*🔄 Recurring Swaps (DCA):*\n";
        swaps.forEach(s => {
          response += `• *ID*: \`${s.id}\` | ${s.amountPerSwap} ${s.fromAsset} → ${s.toAsset} | Completed: ${s.swapsCompleted}/${s.totalSwaps} | Every ${s.intervalSeconds}s\n`;
        });
        response += "\n";
      }

      if (transfers.length > 0) {
        response += "*💸 Recurring Allowances:*\n";
        transfers.forEach(t => {
          response += `• *ID*: \`${t.id}\` | ${t.amountPerTransfer} ${t.assetCode} to ${t.recipientName || t.recipientAddr.slice(0, 8)}... | Completed: ${t.transfersCompleted}/${t.totalTransfers} | Every ${t.intervalSeconds}s\n`;
        });
        response += "\n";
      }

      if (limits.length > 0) {
        response += "*📈 Limit Orders:*\n";
        limits.forEach(l => {
          response += `• *ID*: \`${l.id}\` | Swap ${l.amount} XLM → USDC when price hits ${l.triggerPrice} USDC\n`;
        });
      }

      return response;
    }

    case "cancel_job": {
      const jobId = args.jobId;
      
      const swap = await prisma.recurringSwapJob.findUnique({ where: { id: jobId } });
      if (swap && swap.chatId === chatId) {
        await prisma.recurringSwapJob.update({ where: { id: jobId }, data: { isActive: false } });
        return `Successfully cancelled recurring swap job: \`${jobId}\`.`;
      }

      const transfer = await prisma.recurringTransferJob.findUnique({ where: { id: jobId } });
      if (transfer && transfer.chatId === chatId) {
        await prisma.recurringTransferJob.update({ where: { id: jobId }, data: { isActive: false } });
        return `Successfully cancelled recurring transfer job: \`${jobId}\`.`;
      }

      const limit = await prisma.limitOrderJob.findUnique({ where: { id: jobId } });
      if (limit && limit.chatId === chatId) {
        await prisma.limitOrderJob.update({ where: { id: jobId }, data: { isActive: false } });
        return `Successfully cancelled limit order job: \`${jobId}\`.`;
      }

      return `No active job found with ID: \`${jobId}\`.`;
    }

    case "export_wallet": {
      const pending = await getPendingAction(chatId);
      const isConfirmed = await isLatestMessageConfirmation(chatId);
      const argsMatch = pending && pending.name === "export_wallet";

      if (!pending || !argsMatch || !isConfirmed) {
        await savePendingAction(chatId, "export_wallet", {});
        return `CONFIRMATION_REQUIRED: You must warn the user about the security risk of displaying their private key in chat, and ask them to explicitly confirm by replying 'yes' or 'confirm' to view it.`;
      }

      await clearPendingAction(chatId);

      const secretKey = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
      const publicKey = Keypair.fromSecret(secretKey).publicKey();

      return {
        success: true,
        publicKey,
        secretKey,
        message: `🔑 *Wallet Export Details*\n\n⚠️ *WARNING: NEVER share your Secret Key with anyone. Anyone who has this key can steal all your funds.*\n\n*This message contains highly sensitive keys and will be automatically edited/redacted in 5 minutes for your safety. Please copy and save your keys securely now!*\n\n*Public Address:* \`${publicKey}\`\n*Secret Key:* \`${secretKey}\``
      };
    }

    default:
      throw new Error(`Tool ${name} is not implemented.`);
  }
}


