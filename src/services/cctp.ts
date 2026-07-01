import axios from "axios";
import {
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Horizon,
  rpc,
  xdr,
  Address,
  Operation
} from "@stellar/stellar-sdk";
import { config } from "./config";

const horizonServer = new Horizon.Server(config.stellarHorizonUrl);
const rpcServer = new rpc.Server(config.stellarRpcUrl);

const PASSPHRASE = config.stellarPassphrase;
const CIRCLE_API_URL = config.circleApiUrl;
const STELLAR_CCTP_FORWARDER = config.stellarCctpForwarder;
const STELLAR_TOKEN_MESSENGER = config.stellarTokenMessenger;

/**
 * Polls Circle's Attestation API until the burn transaction has been signed by the oracle network.
 * Returns the hex attestation string.
 */
export async function pollForCircleAttestation(messageHash: string, maxAttempts = 40): Promise<string> {
  const url = `${CIRCLE_API_URL}/attestations/${messageHash}`;
  console.log(`Polling Circle for attestation on ${messageHash}...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(url);
      
      if (response.data && response.data.status === "complete") {
        console.log("Circle CCTP attestation successfully retrieved!");
        return response.data.attestation; // Hex representation
      }
      
      console.log(`Circle status: ${response.data?.status || "pending"}. Attempt ${attempt}/${maxAttempts}. Waiting 10s...`);
    } catch (error: any) {
      // In early stages, the API might return 404 until the burn is processed by the relayers
      if (error.response?.status !== 404) {
        console.error("Error polling Circle Attestation API:", error.message);
      } else {
        console.log(`Attestation 404 (not indexed yet). Attempt ${attempt}/${maxAttempts}. Waiting 10s...`);
      }
    }
    
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  
  throw new Error(`CCTP Attestation polling timed out after ${maxAttempts * 10} seconds.`);
}

/**
 * Polls Circle's Attestation API using the source transaction hash.
 * Returns the hex attestation string and the message bytes.
 */
export async function pollForCircleAttestationByTxHash(txHash: string, sourceDomain: number, maxAttempts = 40): Promise<{ attestationHex: string, messageBytesHex: string }> {
  const url = `${CIRCLE_API_URL}/messages/${sourceDomain}?transactionHash=${txHash}`;
  console.log(`Polling Circle for attestation on txHash ${txHash} from domain ${sourceDomain}...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(url);
      
      if (response.data && response.data.messages && response.data.messages.length > 0) {
        const messageObj = response.data.messages[0];
        if (messageObj.attestation && messageObj.attestation !== "PENDING") {
          console.log("Circle CCTP attestation successfully retrieved by txHash!");
          return {
            attestationHex: messageObj.attestation,
            messageBytesHex: messageObj.message
          };
        }
      }
      
      console.log(`Circle status: pending. Attempt ${attempt}/${maxAttempts}. Waiting 10s...`);
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error("Error polling Circle Attestation API by txHash:", error.message);
      } else {
        console.log(`Attestation 404 (not indexed yet). Attempt ${attempt}/${maxAttempts}. Waiting 10s...`);
      }
    }
    
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  
  throw new Error(`CCTP Attestation polling by txHash timed out after ${maxAttempts * 10} seconds.`);
}

/**
 * Submits the CCTP attestation and message to the Stellar CctpForwarder contract to mint USDC on Stellar.
 * Returns the final Stellar transaction hash.
 */
export async function mintUSDCOnStellar(
  secretKey: string,
  messageBytesHex: string,
  attestationHex: string
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const account = await horizonServer.loadAccount(publicKey);

  // Convert hex strings to Buffers
  const cleanMessageHex = messageBytesHex.startsWith("0x") ? messageBytesHex.slice(2) : messageBytesHex;
  const cleanAttestationHex = attestationHex.startsWith("0x") ? attestationHex.slice(2) : attestationHex;
  
  const messageBuffer = Buffer.from(cleanMessageHex, "hex");
  const attestationBuffer = Buffer.from(cleanAttestationHex, "hex");

  // Construct invocation operation
  // mint_and_forward(message: Bytes, attestation: Bytes)
  const invokeOp = Operation.invokeContractFunction({
    contract: STELLAR_CCTP_FORWARDER,
    function: "mint_and_forward",
    args: [
      xdr.ScVal.scvBytes(messageBuffer),
      xdr.ScVal.scvBytes(attestationBuffer)
    ]
  });

  let tx: any = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
  })
    .addOperation(invokeOp)
    .setTimeout(120)
    .build();

  // 1. Simulate transaction
  console.log("Simulating mint_and_forward transaction on Soroban...");
  const simulation = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`CCTP Mint simulation failed: ${simulation.error}`);
  }

  // 2. Assemble simulation results
  tx = rpc.assembleTransaction(tx, simulation);
  
  // 3. Sign and Submit
  tx.sign(sourceKeypair);
  console.log("Sending mint_and_forward transaction to Stellar RPC...");
  const sendResult = await rpcServer.sendTransaction(tx);
  if (sendResult.status === "ERROR") {
    throw new Error(`CCTP Mint submit failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // 4. Poll for transaction confirmation
  let txResult = await rpcServer.getTransaction(sendResult.hash);
  let attempts = 0;
  while (txResult.status === "NOT_FOUND" && attempts < 15) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    txResult = await rpcServer.getTransaction(sendResult.hash);
    attempts++;
  }

  if (txResult.status !== "SUCCESS") {
    throw new Error(`CCTP Mint transaction failed to finalize. Status: ${txResult.status}`);
  }

  console.log(`CCTP Mint finalized! Hash: ${sendResult.hash}`);
  return sendResult.hash;
}

/**
 * Burns USDC on Stellar using the TokenMessenger contract to bridge to EVM.
 * Returns the transaction hash to be used for attestation polling.
 */
export async function burnUSDCOnStellar(
  secretKey: string,
  amountStr: string, // in USDC decimal format (e.g. "10.5")
  evmRecipientAddress: string,
  evmDomainId: number = 6 // Default to Base Sepolia/Mainnet (Base is domain 6)
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const publicKey = sourceKeypair.publicKey();
  const account = await horizonServer.loadAccount(publicKey);

  // Convert amount to 7 decimals for Stellar USDC
  const amountParsed = parseFloat(amountStr);
  const amountI128 = BigInt(Math.floor(amountParsed * 10_000_000)).toString();

  // Clean EVM address to 32 bytes (pad left)
  const cleanEvm = evmRecipientAddress.startsWith("0x") ? evmRecipientAddress.slice(2) : evmRecipientAddress;
  const evmBytes = Buffer.from(cleanEvm.padStart(64, "0"), "hex");

  // burn_token address (USDC on Stellar) is needed. We can derive it by fetching the USDC asset address, or we can use the known contract ID.
  // Actually, on Stellar CCTP, the deposit_for_burn args:
  // amount: i128
  // destination_domain: u32
  // mint_recipient: bytesN<32>
  // burn_token: Address
  
  // We need the Stellar USDC contract ID.
  // For testnet it's typically known. Let's use config.usdcStellarContract if available, else derive from asset.
  let stellarUsdcContract = "";
  if (config.isMainnet) {
    stellarUsdcContract = "CEQKNGVDNAPIE3LOMV4LBA6Z44LUDH55C75A77ZOF3W257AHTN52N7XY";
  } else {
    // Standard testnet USDC contract
    stellarUsdcContract = "CCW67TSZV36DOOMC4OMGEEEQAM3L2T7A4Z3FY7JUSVAF5F2CIGT2MDF7"; 
  }

  const invokeOp = Operation.invokeContractFunction({
    contract: STELLAR_TOKEN_MESSENGER,
    function: "deposit_for_burn",
    args: [
      xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: new xdr.Int64([0, 0]),
        lo: xdr.Uint64.fromString(amountI128)
      })),
      xdr.ScVal.scvU32(evmDomainId),
      xdr.ScVal.scvBytes(evmBytes),
      Address.fromString(stellarUsdcContract).toScVal()
    ]
  });

  let tx: any = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE
  })
    .addOperation(invokeOp)
    .setTimeout(120)
    .build();

  console.log("Simulating deposit_for_burn transaction on Soroban...");
  const simulation = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`CCTP Burn simulation failed: ${simulation.error}`);
  }

  tx = rpc.assembleTransaction(tx, simulation);
  tx.sign(sourceKeypair);
  
  console.log("Sending deposit_for_burn transaction to Stellar RPC...");
  const sendResult = await rpcServer.sendTransaction(tx);
  if (sendResult.status === "ERROR") {
    throw new Error(`CCTP Burn submit failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  let txResult = await rpcServer.getTransaction(sendResult.hash);
  let attempts = 0;
  while (txResult.status === "NOT_FOUND" && attempts < 15) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    txResult = await rpcServer.getTransaction(sendResult.hash);
    attempts++;
  }

  if (txResult.status !== "SUCCESS") {
    throw new Error(`CCTP Burn transaction failed to finalize. Status: ${txResult.status}`);
  }

  console.log(`CCTP Burn finalized! Hash: ${sendResult.hash}`);
  return sendResult.hash;
}
