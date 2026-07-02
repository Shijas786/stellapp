import { Keypair, Asset, Networks } from "@stellar/stellar-sdk";
import crypto from "crypto";
import path from "path";
import { config } from "./config";
import { prisma } from "./db";
import { USDC_ASSET } from "./stellar";
import { ChainClient, keypairSigner } from "../zk/chain/client";
import { pointFromBytes, type Point } from "../zk/crypto/grumpkin";
import { deriveKeys, type KeyPair } from "../zk/crypto/keys";
import { addressToField } from "../zk/crypto/address";
import { frMod, toHex32 } from "../zk/crypto/field";
import { buildRegisterWitness } from "../zk/witness/register";
import { buildWithdrawWitness } from "../zk/witness/withdraw";
import { buildTransferWitness } from "../zk/witness/transfer";
import { CircuitProver } from "../zk/proving/prover";
import { loadCircuit } from "../zk/proving/artifacts";
import {
  submitRegister, submitDeposit, submitMerge, submitWithdraw, submitTransfer
} from "../zk/chain/contract";
import { StateEngine } from "../zk/state";
import { JsonFileStore } from "../zk/state/json-store";

// Pre-deployed testnet contracts for OpenZeppelin Confidential Token Demo
export const CONFIDENTIAL_CONTRACTS = {
  token: "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F",
  verifier: "CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL",
  auditor: "CA4II62E35TQKPGHCPBD6EBAS732GSGS6H37UUWKEDHR4YTBVMPHVY4L"
};

const AUDITOR_ID = 0;
const DEPLOYED_AT_LEDGER = 5123000; // Safe starting ledger for testnet events

// Persistent store for user confidential states (keys, openings)
const stateStorePath = path.join(process.cwd(), "scratch", "confidential_state.json");
const stateStore = new JsonFileStore(stateStorePath);

// Initialize Circuit Provers lazily to save startup memory/time
let registerProver: CircuitProver | null = null;
let withdrawProver: CircuitProver | null = null;
let transferProver: CircuitProver | null = null;

function getRegisterProver() {
  if (!registerProver) registerProver = new CircuitProver(loadCircuit("register"));
  return registerProver;
}

function getWithdrawProver() {
  if (!withdrawProver) withdrawProver = new CircuitProver(loadCircuit("withdraw"));
  return withdrawProver;
}

function getTransferProver() {
  if (!transferProver) transferProver = new CircuitProver(loadCircuit("transfer"));
  return transferProver;
}

/**
 * Get or deploy the confidential token wrapper contracts for a given assetCode.
 */
export async function getOrDeployConfidentialToken(
  secretKey: string,
  assetCode: string
): Promise<{ token: string; verifier: string; auditor: string }> {
  const code = assetCode.toUpperCase();

  // 1. Check if already registered/deployed
  const existing = await prisma.confidentialRegistry.findUnique({
    where: { assetCode: code }
  });
  if (existing) {
    return {
      token: existing.tokenContract,
      verifier: existing.verifierContract,
      auditor: existing.auditorContract
    };
  }

  // 2. Fallback to hardcoded pre-deployed contracts for XLM
  if (code === "XLM") {
    const registry = await prisma.confidentialRegistry.create({
      data: {
        assetCode: "XLM",
        tokenContract: CONFIDENTIAL_CONTRACTS.token,
        verifierContract: CONFIDENTIAL_CONTRACTS.verifier,
        auditorContract: CONFIDENTIAL_CONTRACTS.auditor
      }
    });
    return {
      token: registry.tokenContract,
      verifier: registry.verifierContract,
      auditor: registry.auditorContract
    };
  }

  // 3. Deploy dynamically on-chain using CLI
  const kp = Keypair.fromSecret(secretKey);
  const underlyingAsset = code === "USDC" ? USDC_ASSET : new Asset(code, kp.publicKey());
  const underlyingContractId = underlyingAsset.contractId(config.stellarPassphrase);

  console.log(`[ZK] Deploying new ConfidentialToken wrapper for ${code}...`);
  console.log(`[ZK] Underlying asset contract: ${underlyingContractId}`);

  const verifier = CONFIDENTIAL_CONTRACTS.verifier;
  const auditor = CONFIDENTIAL_CONTRACTS.auditor;
  const wasmPath = path.join(process.cwd(), "contracts_wasm", "confidential_token.wasm");

  const cmd = `stellar contract deploy \
    --wasm "${wasmPath}" \
    --source-account "${secretKey}" \
    --network testnet \
    --optimize=false \
    -- \
    --underlying_asset "${underlyingContractId}" \
    --verifier "${verifier}" \
    --auditor "${auditor}"`;

  const { execSync } = require("child_process");
  const out = execSync(cmd, { encoding: "utf8" });

  const token = out.split(/\s+/).filter(Boolean).pop()!;
  if (!token || !token.startsWith("C")) {
    throw new Error(`Unexpected contract deployment output: ${out}`);
  }

  console.log(`[ZK] Deployed ConfidentialToken wrapper for ${code} at: ${token}`);

  const registry = await prisma.confidentialRegistry.create({
    data: {
      assetCode: code,
      tokenContract: token,
      verifierContract: verifier,
      auditorContract: auditor
    }
  });

  return {
    token: registry.tokenContract,
    verifier: registry.verifierContract,
    auditor: registry.auditorContract
  };
}

/**
 * Initialize RPC ChainClient for dynamic token contract ID
 */
export function getChainClient(contracts: { token: string; verifier: string; auditor: string }): ChainClient {
  return new ChainClient({
    rpcUrl: config.stellarRpcUrl,
    networkPassphrase: config.stellarPassphrase,
    contracts
  });
}

/**
 * Derives the deterministic Grumpkin private spending key (sk) from a user's Stellar secret key
 */
export function deriveConfidentialKeys(stellarSecret: string, tokenAddress: string): KeyPair {
  const addrF = addressToField(tokenAddress);
  const hash = crypto.createHash("sha256")
    .update(stellarSecret + ":" + tokenAddress + ":confidential-token-v2")
    .digest();
  
  let v = 0n;
  for (const byte of hash) {
    v = (v << 8n) | BigInt(byte);
  }
  const sk = frMod(v);
  return deriveKeys(sk, addrF);
}

/**
 * Register a user's confidential viewing/spending keys on-chain.
 */
export async function registerConfidential(secretKey: string, assetCode: string): Promise<string> {
  const kp = Keypair.fromSecret(secretKey);
  const publicKey = kp.publicKey();
  
  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);
  
  // 1. Check if already registered
  const onchainAccount = await client.confidentialBalance(publicKey);
  if (onchainAccount) {
    return `User is already registered for confidential transfers in ${assetCode}.`;
  }

  // 2. Generate registration ZK proof
  const keys = deriveConfidentialKeys(secretKey, contracts.token);
  const w = buildRegisterWitness(keys);
  
  console.log(`[ZK] Generating registration proof for ${publicKey} (${assetCode})...`);
  const prover = getRegisterProver();
  const { proof } = await prover.prove(w.inputs);

  // 3. Submit transaction
  const result = await submitRegister(client, signer, publicKey, AUDITOR_ID, w, proof);
  return result.hash;
}

/**
 * Deposit public tokens into the user's confidential receiving balance.
 */
export async function depositConfidential(secretKey: string, amount: string, assetCode: string): Promise<string> {
  const kp = Keypair.fromSecret(secretKey);
  const publicKey = kp.publicKey();
  
  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);
  
  const scaledAmount = BigInt(Math.floor(parseFloat(amount) * 10000000)); // 7 decimals
  
  console.log(`[ZK] Depositing ${amount} ${assetCode} into confidential balance for ${publicKey}...`);
  const result = await submitDeposit(client, signer, publicKey, publicKey, scaledAmount);
  return result.hash;
}

/**
 * Merge user's receiving balance into their spendable balance.
 */
export async function mergeConfidential(secretKey: string, assetCode: string): Promise<string> {
  const kp = Keypair.fromSecret(secretKey);
  const publicKey = kp.publicKey();
  
  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);
  
  console.log(`[ZK] Merging receiving balance into spendable for ${publicKey} (${assetCode})...`);
  const result = await submitMerge(client, signer, publicKey);
  return result.hash;
}

/**
 * Get a user's current spendable and receiving balances from their on-chain events.
 */
export async function getConfidentialBalances(
  secretKey: string,
  assetCode: string
): Promise<{ spendable: string; receiving: string; registered: boolean }> {
  const kp = Keypair.fromSecret(secretKey);
  const publicKey = kp.publicKey();
  
  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const keys = deriveConfidentialKeys(secretKey, contracts.token);
  
  const engine = new StateEngine({
    client,
    store: stateStore,
    keys,
    address: publicKey,
    fromLedger: DEPLOYED_AT_LEDGER
  });
  
  const state = await engine.sync();
  
  return {
    spendable: (Number(state.spendable.v) / 10000000).toFixed(7),
    receiving: (Number(state.receiving.v) / 10000000).toFixed(7),
    registered: state.registered
  };
}

/**
 * Transfer tokens privately from one user to another.
 */
export async function transferConfidential(
  secretKey: string,
  recipientAddress: string,
  amount: string,
  assetCode: string
): Promise<string> {
  const kp = Keypair.fromSecret(secretKey);
  const senderPublic = kp.publicKey();
  
  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);
  const senderKeys = deriveConfidentialKeys(secretKey, contracts.token);
  
  // 1. Get recipient viewing key from the contract
  const recipientOnchain = await client.confidentialBalance(recipientAddress);
  if (!recipientOnchain) {
    throw new Error(`Recipient ${recipientAddress} has not registered for confidential transfers yet. They must text the bot first to register.`);
  }

  const pvkB: Point = recipientOnchain.viewingPublicKey;

  // 2. Fetch auditor key
  const kAud = await client.auditorKey(AUDITOR_ID);

  // 3. Sync sender's state to get current balance openings
  const engine = new StateEngine({
    client,
    store: stateStore,
    keys: senderKeys,
    address: senderPublic,
    fromLedger: DEPLOYED_AT_LEDGER
  });
  const senderState = await engine.sync();

  const scaledAmount = BigInt(Math.floor(parseFloat(amount) * 10000000));
  if (senderState.spendable.v < scaledAmount) {
    throw new Error(`Insufficient spendable confidential balance. Available: ${(Number(senderState.spendable.v) / 10000000).toFixed(7)} ${assetCode}.`);
  }

  // 4. Build transfer witness & ZK proof
  const w = buildTransferWitness({
    keys: senderKeys,
    v: senderState.spendable.v,
    r: senderState.spendable.r,
    amount: scaledAmount,
    pvkB,
    kAudR: kAud,
    kAudS: kAud
  });

  console.log(`[ZK] Generating confidential transfer proof of ${amount} ${assetCode} to ${recipientAddress}...`);
  const prover = getTransferProver();
  const { proof } = await prover.prove(w.inputs);

  // 5. Submit confidential transfer on-chain
  const result = await submitTransfer(client, signer, senderPublic, recipientAddress, w, proof);

  // 6. Optimistically update local spendable state to avoid lag
  await engine.setSpendable(w.next);
  
  return result.hash;
}

/**
 * Withdraw privately from confidential spendable balance back to a public Stellar address.
 */
export async function withdrawConfidential(
  secretKey: string,
  recipientAddress: string,
  amount: string,
  assetCode: string
): Promise<string> {
  const kp = Keypair.fromSecret(secretKey);
  const senderPublic = kp.publicKey();
  
  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);
  const senderKeys = deriveConfidentialKeys(secretKey, contracts.token);
  
  // 1. Fetch auditor key
  const kAud = await client.auditorKey(AUDITOR_ID);

  // 2. Sync sender's state to get current balance openings
  const engine = new StateEngine({
    client,
    store: stateStore,
    keys: senderKeys,
    address: senderPublic,
    fromLedger: DEPLOYED_AT_LEDGER
  });
  const senderState = await engine.sync();

  const scaledAmount = BigInt(Math.floor(parseFloat(amount) * 10000000));
  if (senderState.spendable.v < scaledAmount) {
    throw new Error(`Insufficient spendable confidential balance. Available: ${(Number(senderState.spendable.v) / 10000000).toFixed(7)} ${assetCode}.`);
  }

  const w = buildWithdrawWitness({
    keys: senderKeys,
    v: senderState.spendable.v,
    r: senderState.spendable.r,
    amount: scaledAmount,
    kAudS: kAud
  });

  console.log(`[ZK] Generating confidential withdrawal proof of ${amount} ${assetCode}...`);
  const prover = getWithdrawProver();
  const { proof } = await prover.prove(w.inputs);

  // 4. Submit withdrawal on-chain
  const result = await submitWithdraw(client, signer, senderPublic, recipientAddress, scaledAmount, w, proof);

  // 5. Optimistically update local spendable state
  await engine.setSpendable(w.next);
  
  return result.hash;
}
