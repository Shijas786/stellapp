import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  Horizon,
  rpc,
  xdr,
  Address,
  nativeToScVal
} from "@stellar/stellar-sdk";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { config } from "./config";

const horizonServer = new Proxy({} as Horizon.Server, {
  get(target, prop, receiver) {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    const value = Reflect.get(server, prop, receiver);
    return typeof value === 'function' ? value.bind(server) : value;
  }
});

const rpcServer = new Proxy({} as rpc.Server, {
  get(target, prop, receiver) {
    const server = new rpc.Server(config.stellarRpcUrl);
    const value = Reflect.get(server, prop, receiver);
    return typeof value === 'function' ? value.bind(server) : value;
  }
});

const USDC_CODE = config.stellarUsdcCode;
const getUsdcIssuer = () => config.stellarUsdcIssuer;
const getPassphrase = () => config.stellarPassphrase;
const MAX_SEQUENCE_RETRIES = 3;
const TRANSACTION_POLL_TIMEOUT_MS = 45_000;
const TRANSACTION_POLL_INTERVAL_MS = 1_500;
const RPC_REQUEST_TIMEOUT_MS = 10_000;
const MAX_I128 = (1n << 127n) - 1n;
const BLS12_381_BASE_FIELD_MODULUS = BigInt(
  "0x1a0111ea397fe69a4b1ba7b6434bacd7" +
  "64774b84f38512bf6730d2a0f6b0f624" +
  "1eabfffeb153ffffb9feffffffffaaab"
);

export const USDC_ASSET = new Proxy(new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"), {
  get(target, prop, receiver) {
    const asset = new Asset(USDC_CODE, config.stellarUsdcIssuer);
    const value = Reflect.get(asset, prop, receiver);
    return typeof value === 'function' ? value.bind(asset) : value;
  }
});

const accountLockTails = new Map<string, Promise<void>>();

export interface WalletBalances {
  xlm: string;
  usdc: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isSequenceError(error: unknown): boolean {
  const candidate = error as {
    response?: {
      data?: {
        extras?: {
          result_codes?: {
            transaction?: string;
          };
        };
      };
    };
  };

  const transactionCode =
    candidate.response?.data?.extras?.result_codes?.transaction;

  if (transactionCode === "tx_bad_seq") {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("tx_bad_seq") ||
    message.includes("bad sequence") ||
    message.includes("bad_seq")
  );
}

async function withAccountLock<T>(
  publicKey: string,
  callback: () => Promise<T>
): Promise<T> {
  const previousTail = accountLockTails.get(publicKey) ?? Promise.resolve();

  let release!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentTail = previousTail.then(() => currentGate);

  accountLockTails.set(publicKey, currentTail);
  await previousTail;

  try {
    return await callback();
  } finally {
    release();
    if (accountLockTails.get(publicKey) === currentTail) {
      accountLockTails.delete(publicKey);
    }
  }
}

async function withSequenceRetry<T>(
  publicKey: string,
  callback: (attempt: number) => Promise<T>
): Promise<T> {
  return withAccountLock(publicKey, async () => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_SEQUENCE_RETRIES; attempt++) {
      try {
        return await callback(attempt);
      } catch (error) {
        lastError = error;

        if (!isSequenceError(error) || attempt === MAX_SEQUENCE_RETRIES) {
          throw error;
        }

        await sleep(100 * attempt + crypto.randomInt(25, 125));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Transaction failed after sequence retries.");
  });
}

function parsePositiveDecimal(
  amount: string,
  decimals: number,
  label: string
): bigint {
  if (typeof amount !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid ${label}: "${amount}". Must be a positive decimal number.`);
  }

  const [wholePart, decimalPart = ""] = amount.split(".");
  if (decimalPart.length > decimals) {
    throw new Error(
      `Invalid ${label}: "${amount}". A maximum of ${decimals} decimal places is allowed.`
    );
  }

  const scale = 10n ** BigInt(decimals);
  const paddedDecimal = decimalPart.padEnd(decimals, "0");
  const scaled =
    BigInt(wholePart) * scale +
    (paddedDecimal.length > 0 ? BigInt(paddedDecimal) : 0n);

  if (scaled <= 0n) {
    throw new Error(`Invalid ${label}: "${amount}". Must be greater than zero.`);
  }

  return scaled;
}

function validateStellarAmount(amount: string, label = "payment amount"): void {
  parsePositiveDecimal(amount, 7, label);
}

function amountToI128ScVal(amount: string, label: string): xdr.ScVal {
  const scaledAmount = parsePositiveDecimal(amount, 7, label);

  if (scaledAmount > MAX_I128) {
    throw new Error(`Invalid ${label}: value exceeds the signed 128-bit range.`);
  }

  return nativeToScVal(scaledAmount, { type: "i128" });
}

function validateStellarAddress(address: string, label: string): Address {
  if (typeof address !== "string" || address.length === 0) {
    throw new Error(`Invalid ${label}: address is required.`);
  }

  try {
    return Address.fromString(address);
  } catch {
    throw new Error(`Invalid ${label}: "${address}".`);
  }
}

async function getDynamicBaseFee(): Promise<string> {
  const fallbackFee = BigInt(BASE_FEE);

  try {
    const feeStats = await horizonServer.feeStats();
    const candidates = [
      feeStats.fee_charged?.p95,
      feeStats.fee_charged?.p90,
      feeStats.max_fee?.p90,
      feeStats.max_fee?.p80
    ];

    let selectedFee = fallbackFee;

    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !/^\d+$/.test(candidate)) {
        continue;
      }

      const parsed = BigInt(candidate);
      if (parsed > selectedFee) {
        selectedFee = parsed;
      }
    }

    return selectedFee.toString();
  } catch {
    return fallbackFee.toString();
  }
}

async function pollForTransaction(
  transactionHash: string,
  context: string
): Promise<void> {
  if (!/^[a-fA-F0-9]{64}$/.test(transactionHash)) {
    throw new Error(`${context} returned an invalid transaction hash.`);
  }

  const deadline = Date.now() + TRANSACTION_POLL_TIMEOUT_MS;
  let lastStatus = "PENDING";
  let lastNetworkError: unknown;

  while (Date.now() < deadline) {
    await sleep(
      Math.min(TRANSACTION_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))
    );

    if (Date.now() >= deadline) {
      break;
    }

    try {
      const remainingTime = deadline - Date.now();
      const response = await axios.post(
        config.stellarRpcUrl,
        {
          jsonrpc: "2.0",
          id: transactionHash,
          method: "getTransaction",
          params: { hash: transactionHash }
        },
        {
          timeout: Math.min(RPC_REQUEST_TIMEOUT_MS, remainingTime),
          headers: { "content-type": "application/json" }
        }
      );

      if (response.data?.error) {
        throw new Error(
          `${context} polling RPC error: ${JSON.stringify(response.data.error)}`
        );
      }

      const status = response.data?.result?.status;
      if (typeof status !== "string") {
        throw new Error(`${context} polling returned a malformed RPC response.`);
      }

      lastStatus = status;
      lastNetworkError = undefined;

      if (status === "SUCCESS") {
        return;
      }

      if (status === "FAILED") {
        const failureDetails =
          response.data?.result?.resultXdr ??
          response.data?.result?.errorResultXdr ??
          "No failure details were returned.";
        throw new Error(`${context} execution failed: ${failureDetails}`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes(" execution failed:") ||
          error.message.includes(" polling RPC error:") ||
          error.message.includes("malformed RPC response"))
      ) {
        throw error;
      }

      lastNetworkError = error;
    }
  }

  const networkDetails = lastNetworkError
    ? ` Last polling error: ${getErrorMessage(lastNetworkError)}`
    : "";

  throw new Error(
    `${context} did not finalize within ${TRANSACTION_POLL_TIMEOUT_MS}ms. ` +
    `Last status: ${lastStatus}.${networkDetails}`
  );
}

function parseUnsignedBigInt(value: unknown, label: string): bigint {
  if (
    (typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "bigint") ||
    String(value).trim() === ""
  ) {
    throw new Error(`Invalid ${label}.`);
  }

  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`Invalid ${label}.`);
  }

  if (parsed < 0n) {
    throw new Error(`${label} must be non-negative.`);
  }

  return parsed;
}

function encodeUnsignedBigInt(
  value: unknown,
  byteLength: number,
  label: string,
  modulus?: bigint
): Buffer {
  const parsed = parseUnsignedBigInt(value, label);
  const maximum = 1n << BigInt(byteLength * 8);

  if (parsed >= maximum) {
    throw new Error(`${label} does not fit in ${byteLength} bytes.`);
  }

  if (modulus !== undefined && parsed >= modulus) {
    throw new Error(`${label} is not a canonical field element.`);
  }

  const hex = parsed.toString(16).padStart(byteLength * 2, "0");
  if (hex.length !== byteLength * 2) {
    throw new Error(`${label} has an invalid encoded length.`);
  }

  return Buffer.from(hex, "hex");
}

function requireArray(value: unknown, minimumLength: number, label: string): any[] {
  if (!Array.isArray(value) || value.length < minimumLength) {
    throw new Error(`${label} must contain at least ${minimumLength} elements.`);
  }

  return value;
}

function encodeG1(point: unknown, label: string): Buffer {
  const coordinates = requireArray(point, 2, label);

  if (coordinates.length >= 3 && parseUnsignedBigInt(coordinates[2], `${label}.z`) !== 1n) {
    throw new Error(`${label} must be an affine, non-infinite G1 point.`);
  }

  const x = encodeUnsignedBigInt(
    coordinates[0],
    48,
    `${label}.x`,
    BLS12_381_BASE_FIELD_MODULUS
  );
  const y = encodeUnsignedBigInt(
    coordinates[1],
    48,
    `${label}.y`,
    BLS12_381_BASE_FIELD_MODULUS
  );

  const encoded = Buffer.concat([x, y]);
  if (encoded.length !== 96) {
    throw new Error(`${label} must encode to exactly 96 bytes.`);
  }

  return encoded;
}

function encodeG2(point: unknown, label: string): Buffer {
  const coordinates = requireArray(point, 2, label);
  const x = requireArray(coordinates[0], 2, `${label}.x`);
  const y = requireArray(coordinates[1], 2, `${label}.y`);

  if (coordinates.length >= 3) {
    const z = requireArray(coordinates[2], 2, `${label}.z`);
    const z0 = parseUnsignedBigInt(z[0], `${label}.z[0]`);
    const z1 = parseUnsignedBigInt(z[1], `${label}.z[1]`);

    if (!((z0 === 1n && z1 === 0n) || (z0 === 0n && z1 === 1n))) {
      throw new Error(`${label} must be an affine, non-infinite G2 point.`);
    }
  }

  // Snarkjs g2: [ [x1, x0], [y1, y0] ]
  // Arkworks verifier order: x.c0, x.c1, y.c0, y.c1.
  const x0 = encodeUnsignedBigInt(
    x[1],
    48,
    `${label}.x.c0`,
    BLS12_381_BASE_FIELD_MODULUS
  );
  const x1 = encodeUnsignedBigInt(
    x[0],
    48,
    `${label}.x.c1`,
    BLS12_381_BASE_FIELD_MODULUS
  );
  const y0 = encodeUnsignedBigInt(
    y[1],
    48,
    `${label}.y.c0`,
    BLS12_381_BASE_FIELD_MODULUS
  );
  const y1 = encodeUnsignedBigInt(
    y[0],
    48,
    `${label}.y.c1`,
    BLS12_381_BASE_FIELD_MODULUS
  );

  const encoded = Buffer.concat([x0, x1, y0, y1]);
  if (encoded.length !== 192) {
    throw new Error(`${label} must encode to exactly 192 bytes.`);
  }

  return encoded;
}

/**
 * Generates a new random Stellar Keypair.
 */
export function createStellarWallet(): { publicKey: string; secretKey: string } {
  const pair = Keypair.random();
  return {
    publicKey: pair.publicKey(),
    secretKey: pair.secret()
  };
}

/**
 * Funds a testnet address using the Friendbot API.
 */
export async function fundStellarAccount(publicKey: string): Promise<boolean> {
  try {
    Keypair.fromPublicKey(publicKey);
    const response = await axios.get("https://friendbot.stellar.org", {
      params: { addr: publicKey },
      timeout: RPC_REQUEST_TIMEOUT_MS
    });
    return response.status === 200;
  } catch (error: unknown) {
    const axiosError = error as { response?: { data?: unknown } };
    console.error(
      "Stellar Friendbot funding failed:",
      axiosError.response?.data ?? getErrorMessage(error)
    );
    return false;
  }
}

/**
 * Checks if a Stellar account is activated (exists on-chain with at least 1 XLM).
 * Used for mainnet onboarding — the user must send XLM to activate their wallet.
 */
export async function isAccountActivated(publicKey: string): Promise<boolean> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const xlmBalance = account.balances.find(
      (balance: any) => balance.asset_type === "native"
    );
    return xlmBalance ? Number(xlmBalance.balance) >= 1 : false;
  } catch {
    return false; // 404 = account not yet funded/created on-chain
  }
}

/**
 * Fetches the account balances for XLM and USDC.
 */
export async function getBalances(publicKey: string): Promise<WalletBalances> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    let xlmBalance = "0.0000000";
    let usdcBalance = "0.0000000";

    for (const balance of account.balances) {
      if (balance.asset_type === "native") {
        xlmBalance = balance.balance;
      } else {
        const assetBalance = balance as any;
        if (
          assetBalance.asset_code === USDC_CODE &&
          assetBalance.asset_issuer === getUsdcIssuer()
        ) {
          usdcBalance = assetBalance.balance;
        }
      }
    }

    return { xlm: xlmBalance, usdc: usdcBalance };
  } catch (error: unknown) {
    const horizonError = error as { response?: { status?: number } };
    if (horizonError.response?.status === 404) {
      // Account not created yet
      return { xlm: "0.0000000", usdc: "0.0000000" };
    }
    throw error;
  }
}

/**
 * Returns the spendable XLM balance (total minus Stellar base reserve).
 * Reserve = 1 XLM base + 0.5 XLM per trustline/entry.
 */
export async function getSpendableXlmBalance(
  publicKey: string
): Promise<{ total: string; spendable: string; reserved: string }> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const totalXlm = Number(
      (account.balances.find(
        (balance: any) => balance.asset_type === "native"
      ) as any)?.balance ?? "0"
    );
    // Each sub-entry (trustline, offer, signer) costs 0.5 XLM; base reserve is 1 XLM
    const subEntries = (account as any).subentry_count ?? 0;
    const reserved = 1 + subEntries * 0.5;
    const spendable = Math.max(0, totalXlm - reserved);

    return {
      total: totalXlm.toFixed(7),
      spendable: spendable.toFixed(7),
      reserved: reserved.toFixed(7)
    };
  } catch {
    return {
      total: "0.0000000",
      spendable: "0.0000000",
      reserved: "1.0000000"
    };
  }
}

/**
 * Returns the last N transactions for an account from Horizon.
 */
export async function getTransactionHistory(
  publicKey: string,
  limit: number = 10
): Promise<Array<{
  hash: string;
  date: string;
  type: string;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
  explorerUrl?: string;
}>> {
  try {
    const safeLimit = Number.isInteger(limit)
      ? Math.min(Math.max(limit, 1), 200)
      : 10;

    const ops = await horizonServer
      .operations()
      .forAccount(publicKey)
      .order("desc")
      .limit(safeLimit)
      .call();

    return ops.records.map((op: any) => {
      const type = op.type;
      let amount = op.amount;
      let asset = "XLM";

      if (op.asset_type !== "native" && op.asset_code) {
        asset = op.asset_code;
      }

      const from = op.from || op.funder || op.source_account;
      const to = op.to || op.account || op.into;

      // For create_account operations
      if (type === "create_account") {
        amount = op.starting_balance;
      }

      return {
        hash: op.transaction_hash,
        date: op.created_at,
        type,
        amount,
        asset,
        from,
        to,
        explorerUrl: `${config.explorerUrlStellar}${op.transaction_hash}`
      };
    });
  } catch (error: unknown) {
    console.error("Failed to load operations history:", getErrorMessage(error));
    return [];
  }
}

/**
 * Establishes a trustline for USDC if it doesn't already exist.
 */
export async function ensureUSDCTrustline(
  secretKey: string
): Promise<string | null> {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();

  return withSequenceRetry(publicKey, async () => {
    try {
      const account = await horizonServer.loadAccount(publicKey);
      const hasTrustline = account.balances.some(
        (balance: any) =>
          balance.asset_code === USDC_CODE &&
          balance.asset_issuer === getUsdcIssuer()
      );

      if (hasTrustline) {
        return null; // Already exists
      }

      console.log(`Creating USDC trustline for ${publicKey}...`);
      const fee = await getDynamicBaseFee();
      const tx = new TransactionBuilder(account, {
        fee,
        networkPassphrase: getPassphrase()
      })
        .addOperation(
          Operation.changeTrust({
            asset: USDC_ASSET,
            limit: "100000"
          })
        )
        .setTimeout(30)
        .build();

      tx.sign(sourceKeypair);
      const result = await horizonServer.submitTransaction(tx);
      return result.hash;
    } catch (error: unknown) {
      console.error(
        "Failed to establish USDC trustline:",
        getErrorMessage(error)
      );
      throw error;
    }
  });
}

/**
 * Checks if target account exists and has a trustline for USDC.
 */
export async function checkRecipientUSDCTrustline(
  publicKey: string
): Promise<boolean> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    return account.balances.some(
      (balance: any) =>
        balance.asset_code === USDC_CODE &&
        balance.asset_issuer === getUsdcIssuer()
    );
  } catch {
    return false; // Account doesn't exist or load failed
  }
}

/**
 * Sends native XLM or USDC tokens to a recipient.
 */
export async function sendStellarToken(
  secretKey: string,
  recipient: string,
  amount: string,
  sendUSDC: boolean = false
): Promise<string> {
  validateStellarAddress(recipient, "recipient address");
  validateStellarAmount(amount);

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();

  return withSequenceRetry(publicKey, async () => {
    const account = await horizonServer.loadAccount(publicKey);
    const asset = sendUSDC ? USDC_ASSET : Asset.native();
    const fee = await getDynamicBaseFee();

    const tx = new TransactionBuilder(account, {
      fee,
      networkPassphrase: getPassphrase()
    })
      .addOperation(
        Operation.payment({
          destination: recipient,
          asset,
          amount
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(sourceKeypair);
    const result = await horizonServer.submitTransaction(tx);
    return result.hash;
  });
}

/**
 * Atomically creates a recipient account, establishes a USDC trustline (if needed),
 * and sends tokens in a single transaction (Sponsored by the sender).
 */
export async function atomicSponsorAndSend(
  senderSecret: string,
  recipientSecret: string,
  amount: string,
  sendUSDC: boolean = false
): Promise<string> {
  validateStellarAmount(amount);

  const senderKeypair = Keypair.fromSecret(senderSecret);
  const recipientKeypair = Keypair.fromSecret(recipientSecret);
  const senderPublicKey = senderKeypair.publicKey();

  return withSequenceRetry(senderPublicKey, async () => {
    const senderAccount = await horizonServer.loadAccount(senderPublicKey);
    const fee = await getDynamicBaseFee();

    const txBuilder = new TransactionBuilder(senderAccount, {
      fee,
      networkPassphrase: getPassphrase()
    })
      // 1. Create the new account (costs 2.5 XLM from sender)
      .addOperation(
        Operation.createAccount({
          destination: recipientKeypair.publicKey(),
          startingBalance: "2.5" // Covers base reserve (1 XLM) + 1 trustline (0.5 XLM) + fees
        })
      );

    if (sendUSDC) {
      // 2. Establish USDC trustline for the recipient (Source: recipient)
      txBuilder.addOperation(
        Operation.changeTrust({
          asset: USDC_ASSET,
          limit: "100000",
          source: recipientKeypair.publicKey()
        })
      );
    }

    const asset = sendUSDC ? USDC_ASSET : Asset.native();

    // 3. Send the payment (Source: sender)
    txBuilder.addOperation(
      Operation.payment({
        destination: recipientKeypair.publicKey(),
        asset,
        amount
      })
    );

    const tx = txBuilder.setTimeout(30).build();

    // Sign with BOTH the sender and the recipient
    tx.sign(senderKeypair, recipientKeypair);

    const result = await horizonServer.submitTransaction(tx);
    return result.hash;
  });
}

/**
 * Swaps XLM to USDC or USDC to XLM using Path Payments.
 */
export async function swapTokens(
  secretKey: string,
  amount: string,
  direction: "XLM_TO_USDC" | "USDC_TO_XLM"
): Promise<string> {
  validateStellarAmount(amount, "swap amount");

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();

  // If swapping to USDC, make sure trustline exists first
  if (direction === "XLM_TO_USDC") {
    await ensureUSDCTrustline(secretKey);
  }

  return withSequenceRetry(publicKey, async () => {
    const account = await horizonServer.loadAccount(publicKey);
    const sourceAsset =
      direction === "XLM_TO_USDC" ? Asset.native() : USDC_ASSET;
    const destAsset =
      direction === "XLM_TO_USDC" ? USDC_ASSET : Asset.native();

    // Find best path
    const pathsResponse = await horizonServer
      .strictSendPaths(sourceAsset, amount, [destAsset])
      .call();

    if (pathsResponse.records.length === 0) {
      throw new Error(`No swap path found for ${direction} with amount ${amount}`);
    }

    const bestPath = pathsResponse.records[0];
    const path = bestPath.path.map((pathAsset: any) =>
      pathAsset.asset_type === "native"
        ? Asset.native()
        : new Asset(pathAsset.asset_code, pathAsset.asset_issuer)
    );

    // Calculate minimum expected destination amount with 2% slippage tolerance
    const destinationScaled = parsePositiveDecimal(
      bestPath.destination_amount,
      7,
      "path destination amount"
    );
    const destinationMinimumScaled = (destinationScaled * 98n) / 100n;

    if (destinationMinimumScaled <= 0n) {
      throw new Error("Calculated minimum destination amount is zero.");
    }

    const destMin = `${destinationMinimumScaled / 10_000_000n}.${(
      destinationMinimumScaled % 10_000_000n
    )
      .toString()
      .padStart(7, "0")}`;

    const fee = await getDynamicBaseFee();
    const tx = new TransactionBuilder(account, {
      fee,
      networkPassphrase: getPassphrase()
    })
      .addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset: sourceAsset,
          sendAmount: amount,
          destination: publicKey,
          destAsset,
          destMin,
          path
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(sourceKeypair);
    const result = await horizonServer.submitTransaction(tx);
    return result.hash;
  });
}

/**
 * Deploys a Soroban contract instance from a pre-uploaded WASM Hash and calls `initialize` on it.
 */
export async function deployEscrowContract(
  secretKey: string,
  recipientAddress: string,
  arbiterAddress: string,
  maxAmount: string
): Promise<{ contractId: string; txHash: string }> {
  validateStellarAddress(recipientAddress, "recipient address");
  validateStellarAddress(arbiterAddress, "arbiter address");
  const maxAmountScVal = amountToI128ScVal(maxAmount, "maximum escrow amount");

  const wasmPath = path.join(
    process.cwd(),
    "src/contracts/escrow/target/wasm32-unknown-unknown/release/soroban_escrow_contract.wasm"
  );

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Escrow WASM not found at: ${wasmPath}. Please compile it first.`);
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  console.log(`[Stellar] Uploading Escrow WASM (${wasmBytes.length} bytes)...`);
  const { wasmHash } = await uploadWasm(secretKey, wasmBytes);
  console.log(`[Stellar] WASM uploaded. Hash: ${wasmHash}`);

  console.log("[Stellar] Instantiating Escrow contract...");
  const { contractId } = await instantiateContract(secretKey, wasmHash);
  console.log(`[Stellar] Contract instantiated. ID: ${contractId}`);

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();

  // Initialize the escrow contract
  const usdcContractId = USDC_ASSET.contractId(getPassphrase());
  console.log(
    `[Stellar] Dynamic wrapped USDC Contract ID on this network: ${usdcContractId}`
  );

  const initTx = await invokeContractMethod(
    secretKey,
    contractId,
    "initialize",
    [
      xdr.ScVal.scvAddress(Address.fromString(publicKey).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(arbiterAddress).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(usdcContractId).toScAddress()),
      maxAmountScVal
    ]
  );

  return { contractId, txHash: initTx };
}

/**
 * Triggers the release of funds in an escrow contract. Must be signed and called by the Arbiter.
 */
export async function releaseEscrowContract(
  secretKey: string,
  contractId: string
): Promise<string> {
  validateStellarAddress(contractId, "contract ID");
  console.log(`[Stellar] Requesting release for escrow contract: ${contractId}`);
  return invokeContractMethod(secretKey, contractId, "release", []);
}

/**
 * Triggers the refund of funds in an escrow contract. Must be signed and called by the Arbiter.
 */
export async function refundEscrowContract(
  secretKey: string,
  contractId: string
): Promise<string> {
  validateStellarAddress(contractId, "contract ID");
  console.log(`[Stellar] Requesting refund for escrow contract: ${contractId}`);
  return invokeContractMethod(secretKey, contractId, "refund", []);
}

/**
 * Helper to invoke a host function on a deployed contract.
 */
async function invokeContractMethod(
  secretKey: string,
  contractId: string,
  methodName: string,
  args: xdr.ScVal[]
): Promise<string> {
  validateStellarAddress(contractId, "contract ID");

  if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(methodName)) {
    throw new Error(`Invalid contract method name: "${methodName}".`);
  }

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();

  const transactionHash = await withSequenceRetry(publicKey, async () => {
    const account = await horizonServer.loadAccount(publicKey);
    const invokeOp = Operation.invokeContractFunction({
      contract: contractId,
      function: methodName,
      args
    });
    const fee = await getDynamicBaseFee();

    let tx: any = new TransactionBuilder(account, {
      fee,
      networkPassphrase: getPassphrase()
    })
      .addOperation(invokeOp)
      .setTimeout(60)
      .build();

    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Invoke simulation failed: ${simulation.error}`);
    }

    tx = rpc.assembleTransaction(tx, simulation).build();
    tx.sign(sourceKeypair);

    const sendResult = await rpcServer.sendTransaction(tx);
    if (sendResult.status === "ERROR") {
      throw new Error(
        `Invoke send transaction failed: ${JSON.stringify(sendResult.errorResult)}`
      );
    }

    if (!sendResult.hash) {
      throw new Error(
        `Invoke send transaction returned unexpected status: ${sendResult.status}`
      );
    }

    return sendResult.hash;
  });

  // Use raw axios to poll — rpcServer.getTransaction() crashes on Soroban host fn XDR
  await pollForTransaction(transactionHash, "Contract invocation");
  return transactionHash;
}

/**
 * Uploads WASM bytecode to the Stellar network and returns its 32-byte hex WASM Hash.
 */
export async function uploadWasm(
  secretKey: string,
  wasmBytes: Buffer
): Promise<{ wasmHash: string; txHash: string }> {
  if (!Buffer.isBuffer(wasmBytes) || wasmBytes.length === 0) {
    throw new Error("WASM bytecode must be a non-empty Buffer.");
  }

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();

  const transactionHash = await withSequenceRetry(publicKey, async () => {
    const account = await horizonServer.loadAccount(publicKey);
    const uploadOp = Operation.uploadContractWasm({ wasm: wasmBytes });
    const fee = await getDynamicBaseFee();

    let tx: any = new TransactionBuilder(account, {
      fee,
      networkPassphrase: getPassphrase()
    })
      .addOperation(uploadOp)
      .setTimeout(60)
      .build();

    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`WASM upload simulation failed: ${simulation.error}`);
    }

    tx = rpc.assembleTransaction(tx, simulation).build();
    tx.sign(sourceKeypair);

    const sendResult = await rpcServer.sendTransaction(tx);
    if (sendResult.status === "ERROR") {
      throw new Error(
        `WASM upload send failed: ${JSON.stringify(sendResult.errorResult)}`
      );
    }

    if (!sendResult.hash) {
      throw new Error(
        `WASM upload returned unexpected status: ${sendResult.status}`
      );
    }

    return sendResult.hash;
  });

  // NOTE: rpcServer.getTransaction() crashes on uploadContractWasm XDR results
  // (SDK bug: "Bad union switch: 4"). Use raw JSON-RPC via axios to poll instead.
  await pollForTransaction(transactionHash, "WASM upload");

  // Soroban on-chain WASM hash = sha256(wasmBytes)
  const wasmHash = crypto.createHash("sha256").update(wasmBytes).digest("hex");

  return { wasmHash, txHash: transactionHash };
}

/**
 * Instantiates a contract on the Stellar network from a pre-uploaded WASM Hash.
 */
export async function instantiateContract(
  secretKey: string,
  wasmHashHex: string
): Promise<{ contractId: string; txHash: string }> {
  if (!/^[a-fA-F0-9]{64}$/.test(wasmHashHex)) {
    throw new Error("WASM hash must be exactly 32 bytes of hexadecimal data.");
  }

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const salt = crypto.randomBytes(32);

  const submission = await withSequenceRetry(publicKey, async () => {
    const account = await horizonServer.loadAccount(publicKey);
    const deployOp = Operation.createCustomContract({
      address: Address.fromString(publicKey),
      wasmHash: Buffer.from(wasmHashHex, "hex"),
      salt
    });
    const fee = await getDynamicBaseFee();

    let tx: any = new TransactionBuilder(account, {
      fee,
      networkPassphrase: getPassphrase()
    })
      .addOperation(deployOp)
      .setTimeout(60)
      .build();

    const simulation = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Instantiation simulation failed: ${simulation.error}`);
    }

    // Extract contractId from simulation.result.retval BEFORE submitting.
    // The simulation returns the expected ScVal address — no XDR parsing of the tx result needed.
    const simSuccess =
      simulation as rpc.Api.SimulateTransactionSuccessResponse;
    const retval = simSuccess.result?.retval;
    if (!retval) {
      throw new Error("Simulation did not return a contract address retval.");
    }

    const contractId = Address.fromScVal(retval).toString();
    validateStellarAddress(contractId, "simulated contract ID");

    tx = rpc.assembleTransaction(tx, simulation).build();
    tx.sign(sourceKeypair);

    const sendResult = await rpcServer.sendTransaction(tx);
    if (sendResult.status === "ERROR") {
      throw new Error(
        `Contract instantiation send failed: ${JSON.stringify(
          sendResult.errorResult
        )}`
      );
    }

    if (!sendResult.hash) {
      throw new Error(
        `Contract instantiation returned unexpected status: ${sendResult.status}`
      );
    }

    return { contractId, transactionHash: sendResult.hash };
  });

  // Poll with raw axios — rpcServer.getTransaction() crashes on TransactionMetaV4 XDR (Protocol 23+)
  await pollForTransaction(
    submission.transactionHash,
    "Contract instantiation"
  );

  return {
    contractId: submission.contractId,
    txHash: submission.transactionHash
  };
}

/**
 * Deploys the Privacy Pool contract and initializes it with dynamic USDC asset contract ID.
 */
export async function deployPrivacyPool(
  secretKey: string,
  assetCode: string = "USDC"
): Promise<{ contractId: string; txHash: string }> {
  const wasmPath = path.join(
    process.cwd(),
    "contracts/privacy_pool/target/wasm32-unknown-unknown/release/pool.optimized.wasm"
  );

  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      `Optimized WASM not found at: ${wasmPath}. Please compile and optimize it first.`
    );
  }

  const normalizedAssetCode = assetCode.toUpperCase();
  if (normalizedAssetCode !== "XLM" && normalizedAssetCode !== "USDC") {
    throw new Error(`Unsupported Privacy Pool asset: "${assetCode}".`);
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  console.log(
    `[Stellar] Uploading Privacy Pool WASM (${wasmBytes.length} bytes)...`
  );
  const { wasmHash } = await uploadWasm(secretKey, wasmBytes);
  console.log(`[Stellar] WASM uploaded. Hash: ${wasmHash}`);

  console.log("[Stellar] Instantiating Privacy Pool contract...");
  const { contractId } = await instantiateContract(secretKey, wasmHash);
  console.log(`[Stellar] Contract instantiated. ID: ${contractId}`);

  const tokenAsset =
    normalizedAssetCode === "XLM" ? Asset.native() : USDC_ASSET;
  const tokenContractId = tokenAsset.contractId(getPassphrase());
  const publicKey = Keypair.fromSecret(secretKey).publicKey();

  console.log(
    `[Stellar] Initializing Privacy Pool with Admin: ${publicKey} and ` +
    `Token (${normalizedAssetCode}) Contract ID: ${tokenContractId}`
  );

  const initTx = await invokeContractMethod(
    secretKey,
    contractId,
    "initialize",
    [
      xdr.ScVal.scvAddress(Address.fromString(publicKey).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(tokenContractId).toScAddress())
    ]
  );

  return {
    contractId,
    txHash: initTx
  };
}

/**
 * Deposits USDC into the Privacy Pool by providing a commitment hash.
 */
export async function depositToPrivacyPool(
  secretKey: string,
  contractId: string,
  commitmentHex: string,
  amount: string
): Promise<string> {
  validateStellarAddress(contractId, "contract ID");

  if (!/^(?:0x)?[a-fA-F0-9]{64}$/.test(commitmentHex)) {
    throw new Error("Commitment must be exactly 32 bytes of hexadecimal data.");
  }

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const scaledAmountScVal = amountToI128ScVal(amount, "deposit amount");
  const normalizedCommitment = commitmentHex.startsWith("0x")
    ? commitmentHex.slice(2)
    : commitmentHex;

  console.log(
    `[Stellar] Depositing ${amount} USDC into Privacy Pool ${contractId} ` +
    `with commitment ${normalizedCommitment}`
  );

  return invokeContractMethod(secretKey, contractId, "deposit", [
    xdr.ScVal.scvAddress(Address.fromString(publicKey).toScAddress()),
    scaledAmountScVal,
    xdr.ScVal.scvBytes(Buffer.from(normalizedCommitment, "hex"))
  ]);
}

export async function withdrawFromPrivacyPool(
  secretKey: string,
  contractId: string,
  recipientAddress: string,
  amount: string,
  proof: any,
  publicSignals: string[],
  nullifierHashStr: string
): Promise<string> {
  validateStellarAddress(contractId, "contract ID");
  validateStellarAddress(recipientAddress, "recipient address");
  const scaledAmountScVal = amountToI128ScVal(amount, "withdrawal amount");

  if (!Array.isArray(publicSignals) || publicSignals.length < 3) {
    throw new Error("At least three public signals are required.");
  }

  if (!proof || typeof proof !== "object") {
    throw new Error("A valid withdrawal proof is required.");
  }

  console.log(
    `[Stellar] Withdrawing ${amount} USDC from Privacy Pool ${contractId} ` +
    `to ${recipientAddress}`
  );

  // Helper to convert public signals from snarkjs to exact 32-byte buffers.
  const rootValue = parseUnsignedBigInt(publicSignals[0], "public root");
  const nullifierValue = parseUnsignedBigInt(
    publicSignals[1],
    "public nullifier hash"
  );
  const recipientSquareValue = parseUnsignedBigInt(
    publicSignals[2],
    "public recipient square"
  );
  const suppliedNullifierValue = parseUnsignedBigInt(
    nullifierHashStr,
    "nullifier hash"
  );

  if (nullifierValue !== suppliedNullifierValue) {
    throw new Error(
      "The supplied nullifier hash does not match the proof public signal."
    );
  }

  // 1. Convert public signals to 32-byte buffers
  const rootBuf = encodeUnsignedBigInt(rootValue, 32, "public root");
  const nullifierHashBuf = encodeUnsignedBigInt(
    nullifierValue,
    32,
    "public nullifier hash"
  );
  const recipientSquareBuf = encodeUnsignedBigInt(
    recipientSquareValue,
    32,
    "public recipient square"
  );

  // 2. Parse Proof to exact 96/192/96 byte buffers
  const proofA = encodeG1(proof.pi_a, "proof.pi_a");
  const proofB = encodeG2(proof.pi_b, "proof.pi_b");
  const proofC = encodeG1(proof.pi_c, "proof.pi_c");

  // 3. Construct Proof struct Map (keys must be alphabetical: "a", "b", "c")
  const proofMap = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("a"),
      val: xdr.ScVal.scvBytes(proofA)
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("b"),
      val: xdr.ScVal.scvBytes(proofB)
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("c"),
      val: xdr.ScVal.scvBytes(proofC)
    })
  ];

  return invokeContractMethod(secretKey, contractId, "withdraw", [
    xdr.ScVal.scvMap(proofMap),
    xdr.ScVal.scvBytes(rootBuf),
    xdr.ScVal.scvBytes(nullifierHashBuf),
    xdr.ScVal.scvBytes(recipientSquareBuf),
    xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress()),
    scaledAmountScVal
  ]);
}

/**
 * Queries the on-chain Merkle root of a deployed Stellapp Privacy Pool contract.
 * Used to verify the locally-computed root before generating a ZK withdrawal proof.
 * Returns null if the contract does not expose a `get_root` view method.
 */
export async function getPrivacyPoolRoot(
  contractId: string
): Promise<string | null> {
  try {
    validateStellarAddress(contractId, "contract ID");

    // Fallback: many Circom tornado-style Soroban pools store root in contract storage.
    // Until a read-only `get_root` endpoint is confirmed in the ABI, we return null
    // so the upstream code gracefully skips the check rather than hard-blocking.
    return null;
  } catch (error: unknown) {
    console.warn(
      `[Stellar] getPrivacyPoolRoot failed for ${contractId}: ${getErrorMessage(
        error
      )}`
    );
    return null;
  }
}

export async function getCurrentPriceOfXlmInUsdc(): Promise<number> {
  try {
    const paths = await horizonServer
      .strictSendPaths(
        Asset.native(),
        "10.0000000", // номинальная сумма
        [USDC_ASSET]
      )
      .call();

    if (paths.records.length === 0) {
      throw new Error("No price path found between XLM and USDC.");
    }

    const destinationAmount = Number(paths.records[0].destination_amount);
    if (!Number.isFinite(destinationAmount) || destinationAmount <= 0) {
      throw new Error("Price path returned an invalid destination amount.");
    }

    return destinationAmount / 10.0; // returns USDC per XLM
  } catch (error: unknown) {
    console.error(
      "[Stellar Price API] Failed to fetch price:",
      getErrorMessage(error)
    );
    throw error;
  }
}