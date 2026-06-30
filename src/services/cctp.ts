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
