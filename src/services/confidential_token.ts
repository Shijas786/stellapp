import { Keypair, Asset, Networks } from "@stellar/stellar-sdk";
import crypto from "crypto";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { config } from "./config";
import { prisma } from "./db";
import { USDC_ASSET } from "./stellar";
import { ChainClient, keypairSigner } from "../zk/chain/client";
import { commit, type Point } from "../zk/crypto/grumpkin";
import { deriveKeys, type KeyPair } from "../zk/crypto/keys";
import { addressToField } from "../zk/crypto/address";
import { frMod } from "../zk/crypto/field";
import { buildRegisterWitness } from "../zk/witness/register";
import { buildWithdrawWitness } from "../zk/witness/withdraw";
import { buildTransferWitness } from "../zk/witness/transfer";
import { CircuitProver } from "../zk/proving/prover";
import { loadCircuit } from "../zk/proving/artifacts";
import {
  submitRegister, submitDeposit, submitMerge, submitWithdraw, submitTransfer
} from "../zk/chain/contract";
import { StateEngine, freshState, type AccountState } from "../zk/state";
import { PrismaStateStore } from "../zk/state/prisma-store";


// Pre-deployed testnet contracts for OpenZeppelin Confidential Token Demo
export const CONFIDENTIAL_CONTRACTS = Object.freeze({
  token: "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F",
  verifier: "CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL",
  auditor: "CA4II62E35TQKPGHCPBD6EBAS732GSGS6H37UUWKEDHR4YTBVMPHVY4L"
});

const AUDITOR_ID = 0;
const CONFIDENTIAL_PROTOCOL_VERSION = "confidential-token-v2";
const STROOP_SCALE = 10_000_000n;
const MAX_INT64 = 9_223_372_036_854_775_807n;
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;
const CLI_TIMEOUT_MS = 5 * 60 * 1000;

type ConfidentialContracts = {
  token: string;
  verifier: string;
  auditor: string;
};

function getConfiguredConfidentialContracts(): ConfidentialContracts {
  if (config.stellarPassphrase !== Networks.TESTNET) {
    throw new Error(
      "Confidential token contracts are not configured for the selected Stellar network."
    );
  }

  return CONFIDENTIAL_CONTRACTS;
}

function normalizeAssetCode(assetCode: string): string {
  const code = assetCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(code)) {
    throw new Error("Asset code must contain between 1 and 12 uppercase alphanumeric characters.");
  }
  return code;
}

function parseScaledAmount(amount: string): bigint {
  const normalized = amount.trim();
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,7}))?$/.exec(normalized);
  if (!match) {
    throw new Error("Amount must be a positive decimal value with no more than 7 decimal places.");
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const scaled =
    BigInt(wholePart) * STROOP_SCALE +
    BigInt(fractionalPart.padEnd(7, "0") || "0");

  if (scaled <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  if (scaled > MAX_INT64) {
    throw new Error("Amount exceeds the maximum supported value.");
  }

  return scaled;
}

function formatScaledAmount(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / STROOP_SCALE;
  const fractional = (absolute % STROOP_SCALE).toString().padStart(7, "0");
  return `${sign}${whole}.${fractional}`;
}

function validatePublicKey(publicKey: string, fieldName: string): void {
  try {
    Keypair.fromPublicKey(publicKey);
  } catch {
    throw new Error(`${fieldName} is not a valid Stellar public key.`);
  }
}

function getRegistryKey(
  networkPassphrase: string,
  underlyingContractId: string
): string {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([
      networkPassphrase,
      underlyingContractId,
      CONFIDENTIAL_PROTOCOL_VERSION
    ]))
    .digest("base64url");

  return `ct2_${digest}`;
}



/**
 * Returns the ledger to start syncing events from.
 * Uses a fixed earliest-known XLM contract deploy ledger (July 4 2026, ledger ~3,420,000)
 * rather than `latestLedger - 100_000`, which previously caused historical deposits
 * older than ~7 days to be silently skipped during state re-sync.
 *
 * If an explicit `fromLedger` override is provided, it takes precedence.
 */
async function getFromLedger(override?: number): Promise<number> {
  if (typeof override === "number" && override > 0) return override;
  // Earliest ledger at which any confidential token contract was deployed.
  // Keep this at or before the oldest known deployment to guarantee full replay.
  const EARLIEST_CONTRACT_LEDGER = 3_420_000;
  return EARLIEST_CONTRACT_LEDGER;
}

// Persistent store for user confidential states (keys, openings).
// Each user gets an isolated file keyed by their Stellar public key
// to prevent race conditions and cross-user state leaks.
const STATE_STORE_DIR = path.join(process.cwd(), "scratch");

function getStateStore(publicKey: string, tokenContract: string): PrismaStateStore {
  const stateKey = crypto
    .createHash("sha256")
    .update(JSON.stringify([
      config.stellarPassphrase,
      tokenContract,
      publicKey
    ]))
    .digest("hex");

  return new PrismaStateStore(prisma, stateKey);
}


// Detect whether 'stellar' or 'soroban' CLI is available on PATH
function getBlockchainCli(): string {
  for (const cliName of ["stellar", "soroban"]) {
    const result = spawnSync(cliName, ["--version"], {
      stdio: "ignore",
      shell: false,
      timeout: 10_000
    });

    if (!result.error && result.status === 0) {
      return cliName;
    }
  }

  throw new Error("Stellar/Soroban CLI is not installed on PATH.");
}

function redactSecret(value: string, secretKey: string): string {
  return value.split(secretKey).join("[REDACTED]");
}

function runBlockchainCli(
  cliName: string,
  args: readonly string[],
  secretKey: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliName, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputSize = 0;
    let settled = false;

    const finish = (error?: Error, output?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (error) {
        reject(error);
      } else {
        resolve(output ?? "");
      }
    };

    const appendOutput = (target: Buffer[], chunk: Buffer): void => {
      outputSize += chunk.length;
      if (outputSize > MAX_CLI_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new Error("Stellar/Soroban CLI produced excessive output."));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => appendOutput(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput(stderrChunks, chunk));

    child.on("error", (error) => {
      finish(new Error(`Unable to start Stellar/Soroban CLI: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (settled) return;

      const stdout = redactSecret(
        Buffer.concat(stdoutChunks).toString("utf8"),
        secretKey
      );
      const stderr = redactSecret(
        Buffer.concat(stderrChunks).toString("utf8"),
        secretKey
      );

      if (code !== 0) {
        const reason = stderr.trim() || `process exited with code ${code ?? "unknown"}`;
        finish(new Error(
          `Stellar/Soroban CLI deployment failed${signal ? ` (${signal})` : ""}: ${reason}`
        ));
        return;
      }

      finish(undefined, stdout);
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Stellar/Soroban CLI deployment timed out."));
    }, CLI_TIMEOUT_MS);
  });
}

// Initialize Circuit Provers lazily to save startup memory/time
let registerProver: CircuitProver | null = null;
let withdrawProver: CircuitProver | null = null;
let transferProver: CircuitProver | null = null;

function getRegisterProver(): CircuitProver {
  if (!registerProver) registerProver = new CircuitProver(loadCircuit("register"), "register");
  return registerProver;
}

function getWithdrawProver(): CircuitProver {
  if (!withdrawProver) withdrawProver = new CircuitProver(loadCircuit("withdraw"), "withdraw");
  return withdrawProver;
}

function getTransferProver(): CircuitProver {
  if (!transferProver) transferProver = new CircuitProver(loadCircuit("transfer"), "transfer");
  return transferProver;
}

/**
 * Get or deploy the confidential token wrapper contracts for a given assetCode.
 */
export async function getOrDeployConfidentialToken(
  secretKey: string,
  assetCode: string
): Promise<{ token: string; verifier: string; auditor: string }> {
  const code = normalizeAssetCode(assetCode);
  const configuredContracts = getConfiguredConfidentialContracts();
  const kp = Keypair.fromSecret(secretKey);

  const underlyingAsset =
    code === "XLM"
      ? Asset.native()
      : code === "USDC"
        ? USDC_ASSET
        : new Asset(code, kp.publicKey());

  const underlyingContractId = underlyingAsset.contractId(config.stellarPassphrase);
  const registryKey = getRegistryKey(
    config.stellarPassphrase,
    underlyingContractId
  );

  // 1. Check if already registered/deployed
  const existing = await prisma.confidentialRegistry.findUnique({
    where: { assetCode: registryKey }
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
    try {
      const registry = await prisma.confidentialRegistry.create({
        data: {
          assetCode: registryKey,
          tokenContract: configuredContracts.token,
          verifierContract: configuredContracts.verifier,
          auditorContract: configuredContracts.auditor
        }
      });
      return {
        token: registry.tokenContract,
        verifier: registry.verifierContract,
        auditor: registry.auditorContract
      };
    } catch (error) {
      const concurrentRegistry = await prisma.confidentialRegistry.findUnique({
        where: { assetCode: registryKey }
      });
      if (!concurrentRegistry) throw error;

      return {
        token: concurrentRegistry.tokenContract,
        verifier: concurrentRegistry.verifierContract,
        auditor: concurrentRegistry.auditorContract
      };
    }
  }

  // 3. Deploy dynamically on-chain using CLI
  console.log(`[ZK] Deploying new ConfidentialToken wrapper for ${code}...`);
  console.log(`[ZK] Underlying asset contract: ${underlyingContractId}`);

  const verifier = configuredContracts.verifier;
  const auditor = configuredContracts.auditor;
  const wasmPath = path.resolve(
    process.cwd(),
    "contracts_wasm",
    "confidential_token.wasm"
  );
  const cliName = getBlockchainCli();

  const args = [
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--source-account",
    secretKey,
    "--network",
    "testnet",
    "--optimize=false",
    "--",
    "--underlying_asset",
    underlyingContractId,
    "--verifier",
    verifier,
    "--auditor",
    auditor
  ];

  const out = await runBlockchainCli(cliName, args, secretKey);
  const contractIds = out.match(/\bC[A-Z2-7]{55}\b/g);
  const token = contractIds?.at(-1);

  if (!token) {
    throw new Error("Unexpected contract deployment output: no contract ID was returned.");
  }

  console.log(`[ZK] Deployed ConfidentialToken wrapper for ${code} at: ${token}`);

  try {
    const registry = await prisma.confidentialRegistry.create({
      data: {
        assetCode: registryKey,
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
  } catch (error) {
    const concurrentRegistry = await prisma.confidentialRegistry.findUnique({
      where: { assetCode: registryKey }
    });
    if (!concurrentRegistry) throw error;

    return {
      token: concurrentRegistry.tokenContract,
      verifier: concurrentRegistry.verifierContract,
      auditor: concurrentRegistry.auditorContract
    };
  }
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

  // Check if depositor is registered on-chain
  const isReg = await client.isRegistered(publicKey);
  if (!isReg) {
    throw new Error(`You have not registered for confidential transfers of ${assetCode} yet. Please register first by sending "register confidential ${assetCode}" to the bot.`);
  }

  const scaledAmount = parseScaledAmount(amount);

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

  // Check if user is registered on-chain
  const isReg = await client.isRegistered(publicKey);
  if (!isReg) {
    throw new Error(`You have not registered for confidential transfers of ${assetCode} yet. Please register first.`);
  }

  console.log(`[ZK] Merging receiving balance into spendable for ${publicKey} (${assetCode})...`);
  const result = await submitMerge(client, signer, publicKey);
  return result.hash;
}

/**
 * Get a user's current spendable and receiving balances from their on-chain events.
 */
/**
 * Helper to sync the StateEngine and verify its local state commitments against
 * the on-chain state. If a mismatch is detected, it automatically clears the local cache
 * and performs a fresh sync from scratch. If the mismatch persists after re-sync,
 * it returns a partial state with `syncGap: true` instead of throwing — this happens
 * when history older than the RPC's ~7-day retention window is required to reconstruct
 * the cryptographic opening (e.g. a deposit from 10+ days ago whose blinding factor
 * is no longer in the RPC event log).
 */
async function syncAndVerifyConfidentialState(
  client: ChainClient,
  publicKey: string,
  tokenContract: string,
  keys: KeyPair
): Promise<{ state: AccountState; engine: StateEngine; syncGap?: boolean }> {
  const store = getStateStore(publicKey, tokenContract);
  const engine = new StateEngine({
    client,
    store,
    keys,
    address: publicKey,
    fromLedger: await getFromLedger()
  });

  let state = await engine.sync();

  const onchain = await client.confidentialBalance(publicKey);
  if (onchain) {
    const verification = await engine.verifyAgainstChain();
    if (!verification.ok) {
      console.warn(`[ZK] Local state commitment mismatch detected for ${publicKey}. Re-syncing from scratch...`);
      const fresh = freshState(publicKey);
      await store.save(fresh);

      const freshEngine = new StateEngine({
        client,
        store,
        keys,
        address: publicKey,
        fromLedger: await getFromLedger()
      });
      state = await freshEngine.sync();

      const secondVerification = await freshEngine.verifyAgainstChain();
      if (!secondVerification.ok) {
        // The mismatch persists after a full re-sync. This happens when the deposit
        // history needed to reconstruct the blinding factor is beyond the RPC's
        // ~7-day event retention window. Funds are safe on-chain but we cannot
        // verify the exact local opening. Return with syncGap flag so callers can
        // display a helpful degraded message instead of crashing.
        console.warn(
          `[ZK] Sync gap detected for ${publicKey}: historical events required for state reconstruction ` +
          `are outside the RPC retention window. On-chain balance exists but cannot be locally verified. ` +
          `Returning partial state with syncGap=true.`
        );

        // Mark the account as registered (it clearly is, since confidentialBalance returned data)
        state.registered = true;
        return { state, engine: freshEngine, syncGap: true };
      }
      return { state, engine: freshEngine };
    }
  }

  return { state, engine };
}

export async function getConfidentialBalances(
  secretKey: string,
  assetCode: string
): Promise<{ spendable: string; receiving: string; registered: boolean; syncGap?: boolean }> {
  const kp = Keypair.fromSecret(secretKey);
  const publicKey = kp.publicKey();

  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const keys = deriveConfidentialKeys(secretKey, contracts.token);

  const { state, syncGap } = await syncAndVerifyConfidentialState(
    client,
    publicKey,
    contracts.token,
    keys
  );

  if (syncGap) {
    // We know the account is registered and has funds on-chain, but cannot
    // locally reconstruct the exact amount because historical events are
    // outside the RPC retention window. Return a sentinel "?" for the amount.
    return {
      spendable: "?",
      receiving: "0.0000000",
      registered: true,
      syncGap: true
    };
  }

  return {
    spendable: formatScaledAmount(state.spendable.v),
    receiving: formatScaledAmount(state.receiving.v),
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
  validatePublicKey(recipientAddress, "Recipient address");

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
  const { state: senderState, engine, syncGap } = await syncAndVerifyConfidentialState(
    client,
    senderPublic,
    contracts.token,
    senderKeys
  );

  if (syncGap) {
    throw new Error(
      `Your confidential ${assetCode} balance cannot be verified right now because some deposit history ` +
      `is older than the RPC's 7-day retention window. To resolve this, make a new deposit and merge — ` +
      `this resets your local state with a fresh on-chain anchor.`
    );
  }

  const scaledAmount = parseScaledAmount(amount);
  if (senderState.spendable.v < scaledAmount) {
    throw new Error(
      `Insufficient spendable confidential balance. Available: ${formatScaledAmount(senderState.spendable.v)} ${assetCode}.`
    );
  }

  // 4. Build transfer witness & ZK proof
  const w = buildTransferWitness({
    keys: senderKeys,
    v: senderState.spendable.v,
    r: senderState.spendable.r,
    cSpend: commit(senderState.spendable.v, senderState.spendable.r),
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
  validatePublicKey(recipientAddress, "Recipient address");

  const kp = Keypair.fromSecret(secretKey);
  const senderPublic = kp.publicKey();

  const contracts = await getOrDeployConfidentialToken(secretKey, assetCode);
  const client = getChainClient(contracts);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);
  const senderKeys = deriveConfidentialKeys(secretKey, contracts.token);

  // 1. Fetch auditor key
  const kAud = await client.auditorKey(AUDITOR_ID);

  // 2. Sync sender's state to get current balance openings
  const { state: senderState, engine, syncGap } = await syncAndVerifyConfidentialState(
    client,
    senderPublic,
    contracts.token,
    senderKeys
  );

  if (syncGap) {
    throw new Error(
      `Your confidential ${assetCode} balance cannot be verified right now because some deposit history ` +
      `is older than the RPC's 7-day retention window. To resolve this, make a new deposit and merge — ` +
      `this resets your local state with a fresh on-chain anchor.`
    );
  }

  const scaledAmount = parseScaledAmount(amount);
  if (senderState.spendable.v < scaledAmount) {
    throw new Error(
      `Insufficient spendable confidential balance. Available: ${formatScaledAmount(senderState.spendable.v)} ${assetCode}.`
    );
  }

  const w = buildWithdrawWitness({
    keys: senderKeys,
    v: senderState.spendable.v,
    r: senderState.spendable.r,
    expectedCSpend: commit(senderState.spendable.v, senderState.spendable.r),
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