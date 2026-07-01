import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Horizon,
  rpc,
  xdr,
  Address
} from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { config } from "./config";

const horizonServer = new Horizon.Server(config.stellarHorizonUrl);
const rpcServer = new rpc.Server(config.stellarRpcUrl);

const USDC_CODE = config.stellarUsdcCode;
const USDC_ISSUER = config.stellarUsdcIssuer;
const PASSPHRASE = config.stellarPassphrase;
export const USDC_ASSET = new Asset(USDC_CODE, USDC_ISSUER);

export interface WalletBalances {
  xlm: string;
  usdc: string;
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
    const response = await axios.get(`https://friendbot.stellar.org?addr=${publicKey}`);
    return response.status === 200;
  } catch (error: any) {
    console.error("Stellar Friendbot funding failed:", error.response?.data || error.message);
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
    const xlmBalance = account.balances.find((b: any) => b.asset_type === "native");
    return xlmBalance ? parseFloat(xlmBalance.balance) >= 1 : false;
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

    for (const b of account.balances) {
      if (b.asset_type === "native") {
        xlmBalance = b.balance;
      } else {
        const assetB = b as any;
        if (assetB.asset_code === USDC_CODE && assetB.asset_issuer === USDC_ISSUER) {
          usdcBalance = assetB.balance;
        }
      }
    }

    return { xlm: xlmBalance, usdc: usdcBalance };
  } catch (error: any) {
    if (error.response?.status === 404) {
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
export async function getSpendableXlmBalance(publicKey: string): Promise<{ total: string; spendable: string; reserved: string }> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const totalXlm = parseFloat((account.balances.find((b: any) => b.asset_type === "native") as any)?.balance ?? "0");
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
    return { total: "0.0000000", spendable: "0.0000000", reserved: "1.0000000" };
  }
}

/**
 * Returns the last N transactions for an account from Horizon.
 */
export async function getTransactionHistory(publicKey: string, limit: number = 10): Promise<Array<{
  hash: string;
  date: string;
  type: string;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
}>> {
  try {
    const txs = await horizonServer
      .transactions()
      .forAccount(publicKey)
      .order("desc")
      .limit(limit)
      .call();

    return txs.records.map((tx: any) => ({
      hash: tx.hash,
      date: tx.created_at,
      type: tx.operation_count > 1 ? "multi-op" : "transaction",
      explorerUrl: `${config.explorerUrlStellar}${tx.hash}`
    }));
  } catch {
    return [];
  }
}

/**
 * Establishes a trustline for USDC if it doesn't already exist.
 */
export async function ensureUSDCTrustline(secretKey: string): Promise<string | null> {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const hasTrustline = account.balances.some(
      (b: any) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER
    );

    if (hasTrustline) {
      return null; // Already exists
    }

    console.log(`Creating USDC trustline for ${publicKey}...`);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: PASSPHRASE
    })
      .addOperation(
        Operation.changeTrust({
          asset: USDC_ASSET,
          limit: "922337203685.4775807"
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(sourceKeypair);
    const result = await horizonServer.submitTransaction(tx);
    return result.hash;
  } catch (error: any) {
    console.error("Failed to establish USDC trustline:", error.message);
    throw error;
  }
}

/**
 * Checks if target account exists and has a trustline for USDC.
 */
export async function checkRecipientUSDCTrustline(publicKey: string): Promise<boolean> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    return account.balances.some(
      (b: any) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER
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
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const account = await horizonServer.loadAccount(sourceKeypair.publicKey());
  
  const asset = sendUSDC ? USDC_ASSET : Asset.native();

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
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
}

/**
 * Swaps XLM to USDC or USDC to XLM using Path Payments.
 */
export async function swapTokens(
  secretKey: string,
  amount: string,
  direction: "XLM_TO_USDC" | "USDC_TO_XLM"
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();

  // If swapping to USDC, make sure trustline exists first
  if (direction === "XLM_TO_USDC") {
    await ensureUSDCTrustline(secretKey);
  }

  const account = await horizonServer.loadAccount(publicKey);
  const sourceAsset = direction === "XLM_TO_USDC" ? Asset.native() : USDC_ASSET;
  const destAsset = direction === "XLM_TO_USDC" ? USDC_ASSET : Asset.native();

  // Find best path
  const pathsResponse = await horizonServer.strictSendPaths(
    sourceAsset,
    amount,
    [destAsset]
  ).call();

  if (pathsResponse.records.length === 0) {
    throw new Error(`No swap path found for ${direction} with amount ${amount}`);
  }

  const bestPath = pathsResponse.records[0];
  const path = bestPath.path.map((p: any) => new Asset(p.asset_code, p.asset_issuer));
  
  // Calculate minimum expected destination amount with 2% slippage tolerance
  const destMin = (parseFloat(bestPath.destination_amount) * 0.98).toFixed(7);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
  })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: sourceAsset,
        sendAmount: amount,
        destination: publicKey,
        destAsset: destAsset,
        destMin,
        path
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
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
  const wasmHash = process.env.ESCROW_WASM_HASH;
  if (!wasmHash || wasmHash.startsWith("00000000")) {
    throw new Error("ESCROW_WASM_HASH is not set or is invalid in .env file.");
  }

  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const account = await horizonServer.loadAccount(publicKey);
  const salt = crypto.randomBytes(32);

  const deployOp = Operation.createCustomContract({
    address: Address.fromString(publicKey),
    wasmHash: Buffer.from(wasmHash, "hex"),
    salt
  });

  let tx: any = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
  })
    .addOperation(deployOp)
    .setTimeout(60)
    .build();

  const simulation = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Escrow simulation failed: ${simulation.error}`);
  }

  // Extract contractId from simulation retval BEFORE sending (avoids Protocol 23 XDR crash)
  const simSuccess = simulation as rpc.Api.SimulateTransactionSuccessResponse;
  const retval = simSuccess.result?.retval;
  if (!retval) throw new Error("Simulation did not return a contract address.");
  const contractId = Address.fromScVal(retval).toString();

  // assembleTransaction returns TransactionBuilder — must call .build()
  tx = rpc.assembleTransaction(tx, simulation).build();
  tx.sign(sourceKeypair);

  const sendResult = await rpcServer.sendTransaction(tx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Escrow deploy send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Raw axios poll — rpcServer.getTransaction() crashes on Protocol 23+ TransactionMetaV4
  const rpcUrl = config.stellarRpcUrl;
  let pollStatus = "PENDING";
  let attempts = 0;
  while (pollStatus !== "SUCCESS" && pollStatus !== "FAILED" && attempts < 20) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const resp = await axios.post(rpcUrl, {
      jsonrpc: "2.0", id: 1,
      method: "getTransaction",
      params: { hash: sendResult.hash }
    });
    pollStatus = resp.data?.result?.status ?? "NOT_FOUND";
    attempts++;
  }

  if (pollStatus !== "SUCCESS") {
    throw new Error(`Escrow deployment failed to finalize. Status: ${pollStatus}`);
  }

  // Initialize the escrow contract
  const usdcContractId = USDC_ASSET.contractId(PASSPHRASE);
  console.log(`[Stellar] Dynamic wrapped USDC Contract ID on this network: ${usdcContractId}`);

  const initTx = await invokeContractMethod(
    secretKey,
    contractId,
    "initialize",
    [
      xdr.ScVal.scvAddress(Address.fromString(publicKey).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(arbiterAddress).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(usdcContractId).toScAddress()),
      xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: new xdr.Int64(0),
        lo: new xdr.Uint64(BigInt(Math.floor(parseFloat(maxAmount) * 10000000)))
      }))
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
  console.log(`[Stellar] Requesting release for escrow contract: ${contractId}`);
  return await invokeContractMethod(
    secretKey,
    contractId,
    "release",
    []
  );
}

/**
 * Triggers the refund of funds in an escrow contract. Must be signed and called by the Arbiter.
 */
export async function refundEscrowContract(
  secretKey: string,
  contractId: string
): Promise<string> {
  console.log(`[Stellar] Requesting refund for escrow contract: ${contractId}`);
  return await invokeContractMethod(
    secretKey,
    contractId,
    "refund",
    []
  );
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
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const account = await horizonServer.loadAccount(publicKey);

  const invokeOp = Operation.invokeContractFunction({
    contract: contractId,
    function: methodName,
    args
  });

  let tx: any = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
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
    throw new Error(`Invoke send transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Use raw axios to poll — rpcServer.getTransaction() crashes on Soroban host fn XDR
  const rpcUrl = config.stellarRpcUrl;
  let invokeStatus = "PENDING";
  let attempts = 0;
  while (invokeStatus !== "SUCCESS" && invokeStatus !== "FAILED" && attempts < 20) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const resp = await axios.post(rpcUrl, {
      jsonrpc: "2.0", id: 1,
      method: "getTransaction",
      params: { hash: sendResult.hash }
    });
    invokeStatus = resp.data?.result?.status ?? "NOT_FOUND";
    attempts++;
  }

  if (invokeStatus !== "SUCCESS") {
    throw new Error(`Invoke execution failed to finalize. Status: ${invokeStatus}`);
  }

  return sendResult.hash;
}

/**
 * Uploads WASM bytecode to the Stellar network and returns its 32-byte hex WASM Hash.
 */
export async function uploadWasm(
  secretKey: string,
  wasmBytes: Buffer
): Promise<{ wasmHash: string; txHash: string }> {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const account = await horizonServer.loadAccount(publicKey);

  const uploadOp = Operation.uploadContractWasm({ wasm: wasmBytes });

  let tx: any = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
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
    throw new Error(`WASM upload send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // NOTE: rpcServer.getTransaction() crashes on uploadContractWasm XDR results
  // (SDK bug: "Bad union switch: 4"). Use raw JSON-RPC via axios to poll instead.
  const rpcUrl = config.stellarRpcUrl;
  let status = "PENDING";
  let attempts = 0;
  while (status !== "SUCCESS" && status !== "FAILED" && attempts < 20) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const resp = await axios.post(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: { hash: sendResult.hash }
    });
    status = resp.data?.result?.status ?? "NOT_FOUND";
    attempts++;
  }

  if (status !== "SUCCESS") {
    throw new Error(`WASM upload failed to finalize. Final status: ${status}`);
  }

  // Soroban on-chain WASM hash = sha256(wasmBytes)
  const wasmHash = crypto.createHash("sha256").update(wasmBytes).digest("hex");

  return { wasmHash, txHash: sendResult.hash };
}


/**
 * Instantiates a contract on the Stellar network from a pre-uploaded WASM Hash.
 */
export async function instantiateContract(
  secretKey: string,
  wasmHashHex: string
): Promise<{ contractId: string; txHash: string }> {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const account = await horizonServer.loadAccount(publicKey);
  const salt = crypto.randomBytes(32);

  const deployOp = Operation.createCustomContract({
    address: Address.fromString(publicKey),
    wasmHash: Buffer.from(wasmHashHex, "hex"),
    salt
  });

  let tx: any = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
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
  const simSuccess = simulation as rpc.Api.SimulateTransactionSuccessResponse;
  const retval = simSuccess.result?.retval;
  if (!retval) {
    throw new Error("Simulation did not return a contract address retval.");
  }
  const contractId = Address.fromScVal(retval).toString();

  tx = rpc.assembleTransaction(tx, simulation).build();
  tx.sign(sourceKeypair);

  const sendResult = await rpcServer.sendTransaction(tx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Contract instantiation send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Poll with raw axios — rpcServer.getTransaction() crashes on TransactionMetaV4 XDR (Protocol 23+)
  const rpcUrl = config.stellarRpcUrl;
  let pollStatus = "PENDING";
  let attempts = 0;
  while (pollStatus !== "SUCCESS" && pollStatus !== "FAILED" && attempts < 20) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const resp = await axios.post(rpcUrl, {
      jsonrpc: "2.0", id: 1,
      method: "getTransaction",
      params: { hash: sendResult.hash }
    });
    pollStatus = resp.data?.result?.status ?? "NOT_FOUND";
    attempts++;
  }

  if (pollStatus !== "SUCCESS") {
    throw new Error(`Contract instantiation failed to finalize. Status: ${pollStatus}`);
  }

  return { contractId, txHash: sendResult.hash };
}

/**
 * Deploys the Privacy Pool contract and initializes it with dynamic USDC asset contract ID.
 */
export async function deployPrivacyPool(
  secretKey: string
): Promise<{ contractId: string; txHash: string }> {
  const wasmPath = path.join(
    process.cwd(),
    "contracts/privacy_pool/target/wasm32-unknown-unknown/release/pool.optimized.wasm"
  );
  
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Optimized WASM not found at: ${wasmPath}. Please compile and optimize it first.`);
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  console.log(`[Stellar] Uploading Privacy Pool WASM (${wasmBytes.length} bytes)...`);
  const { wasmHash } = await uploadWasm(secretKey, wasmBytes);
  console.log(`[Stellar] WASM uploaded. Hash: ${wasmHash}`);

  console.log(`[Stellar] Instantiating Privacy Pool contract...`);
  const { contractId } = await instantiateContract(secretKey, wasmHash);
  console.log(`[Stellar] Contract instantiated. ID: ${contractId}`);

  const usdcContractId = USDC_ASSET.contractId(PASSPHRASE);
  console.log(`[Stellar] Initializing Privacy Pool with USDC Contract ID: ${usdcContractId}`);

  const initTx = await invokeContractMethod(
    secretKey,
    contractId,
    "initialize",
    [
      xdr.ScVal.scvAddress(Address.fromString(usdcContractId).toScAddress())
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
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const scaledAmount = BigInt(Math.floor(parseFloat(amount) * 10000000)); // 7 decimals

  console.log(`[Stellar] Depositing ${amount} USDC into Privacy Pool ${contractId} with commitment ${commitmentHex}`);

  return await invokeContractMethod(
    secretKey,
    contractId,
    "deposit",
    [
      xdr.ScVal.scvAddress(Address.fromString(publicKey).toScAddress()),
      xdr.ScVal.scvBytes(Buffer.from(commitmentHex, "hex")),
      xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: new xdr.Int64(0),
        lo: new xdr.Uint64(scaledAmount)
      }))
    ]
  );
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
  const scaledAmount = BigInt(Math.floor(parseFloat(amount) * 10000000)); // 7 decimals

  console.log(`[Stellar] Withdrawing ${amount} USDC from Privacy Pool ${contractId} to ${recipientAddress}`);

  // Helper to convert hex from snarkjs to 32 bytes buffer
  const parseHex32 = (hex: string) => {
    let clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    while(clean.length < 64) clean = "0" + clean;
    return Buffer.from(clean, "hex");
  };

  // 1. Convert public signals to 32-byte buffers
  const rootBuf = parseHex32(BigInt(publicSignals[0]).toString(16));
  const nullifierHashBuf = parseHex32(BigInt(publicSignals[1]).toString(16));
  const recipientSquareBuf = parseHex32(BigInt(publicSignals[2]).toString(16));

  // 2. Parse Proof to 96/192/96 byte buffers
  const parseG1 = (arr: any) => {
    const x = parseHex32(BigInt(arr[0]).toString(16));
    const y = parseHex32(BigInt(arr[1]).toString(16));
    let zeros = Buffer.alloc(32); // We need 48 bytes, not 32 for each coordinate
    // Wait, the rust VK generated 48 bytes. Snarkjs coordinates fit in 48 bytes (381 bits).
    // So pad each coordinate to 48 bytes.
    return Buffer.concat([Buffer.alloc(16), x, Buffer.alloc(16), y]);
  };
  
  const parseG1Correct = (arr: any) => {
    const xHexStr = BigInt(arr[0]).toString(16);
    const yHexStr = BigInt(arr[1]).toString(16);
    let xHex = xHexStr; while(xHex.length < 96) xHex = "0" + xHex;
    let yHex = yHexStr; while(yHex.length < 96) yHex = "0" + yHex;
    return Buffer.concat([Buffer.from(xHex, "hex"), Buffer.from(yHex, "hex")]);
  };
  
  const parseG2Correct = (arr: any) => {
    // Snarkjs g2: [ [x1, x0], [y1, y0] ]
    const x1Hex = BigInt(arr[0][0]).toString(16).padStart(96, "0");
    const x0Hex = BigInt(arr[0][1]).toString(16).padStart(96, "0");
    const y1Hex = BigInt(arr[1][0]).toString(16).padStart(96, "0");
    const y0Hex = BigInt(arr[1][1]).toString(16).padStart(96, "0");
    // Arkworks order: c0 then c1.
    return Buffer.concat([
        Buffer.from(x0Hex, "hex"), Buffer.from(x1Hex, "hex"),
        Buffer.from(y0Hex, "hex"), Buffer.from(y1Hex, "hex")
    ]);
  };

  const proofA = parseG1Correct(proof.pi_a);
  const proofB = parseG2Correct(proof.pi_b);
  const proofC = parseG1Correct(proof.pi_c);

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

  return await invokeContractMethod(
    secretKey,
    contractId,
    "withdraw",
    [
      xdr.ScVal.scvMap(proofMap),
      xdr.ScVal.scvBytes(rootBuf),
      xdr.ScVal.scvBytes(nullifierHashBuf),
      xdr.ScVal.scvBytes(recipientSquareBuf),
      xdr.ScVal.scvAddress(Address.fromString(recipientAddress).toScAddress()),
      xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: new xdr.Int64(0),
        lo: new xdr.Uint64(scaledAmount)
      }))
    ]
  );
}

