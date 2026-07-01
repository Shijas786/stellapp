import { ethers } from "ethers";
import { StrKey } from "@stellar/stellar-sdk";
import { config } from "./config";

const provider = new ethers.JsonRpcProvider(config.evmRpcUrl);

// Base CCTP and USDC Contract Addresses
const TokenMessengerAddress = config.evmCctpTokenMessenger;
const MessageTransmitterAddress = config.evmMessageTransmitter;
const USDCAddress = config.evmUsdcAddress;

// Simple Human-Readable ABIs
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const TokenMessenger_ABI = [
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) returns (uint64 nonce)"
];

const MessageTransmitter_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool success)"
];

// Stellar CctpForwarder Contract ID
const STELLAR_CCTP_FORWARDER = config.stellarCctpForwarder;

export interface EVMBalances {
  eth: string;
  usdc: string;
}

/**
 * Creates a random EVM wallet.
 */
export function createEVMWallet(): { address: string; privateKey: string } {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey
  };
}

/**
 * Fetches the ETH and USDC balances of an address.
 */
export async function getEVMBalances(address: string): Promise<EVMBalances> {
  try {
    const ethBalanceWei = await provider.getBalance(address);
    const eth = ethers.formatEther(ethBalanceWei);

    const usdcContract = new ethers.Contract(USDCAddress, ERC20_ABI, provider);
    const usdcBalanceWei = await usdcContract.balanceOf(address);
    const usdc = ethers.formatUnits(usdcBalanceWei, 6); // USDC uses 6 decimals on EVM

    return { eth, usdc };
  } catch (error: any) {
    console.error("Failed to fetch EVM balances:", error.message);
    throw error;
  }
}

/**
 * Helper to build the hookData required by Stellar CctpForwarder.
 */
export function buildCctpForwarderHookData(forwardRecipientStrkey: string): string {
  const encoder = new TextEncoder();
  const recipientBytes = encoder.encode(forwardRecipientStrkey);
  
  const buffer = Buffer.alloc(32 + recipientBytes.length);
  
  // Bytes 0-23: Reserved (must be zeroed)
  // Bytes 24-27: Hook data version (uint32 BE; 0)
  buffer.writeUInt32BE(0, 24);
  
  // Bytes 28-31: forward_recipient byte length (uint32 BE)
  buffer.writeUInt32BE(recipientBytes.length, 28);
  
  // Bytes 32+: forward_recipient string bytes
  Buffer.from(recipientBytes).copy(buffer, 32);
  
  return "0x" + buffer.toString("hex");
}

/**
 * Burns USDC on EVM to bridge to Stellar via CCTP.
 * Returns the EVM transaction hash and the CCTP message nonce/hash.
 */
export async function burnUSDCForCCTP(
  privateKey: string,
  amount: string,
  destStellarPublicKey: string
): Promise<{ txHash: string; messageHash: string; messageBytes: string }> {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const usdcContract = new ethers.Contract(USDCAddress, ERC20_ABI, wallet);
    const tokenMessenger = new ethers.Contract(TokenMessengerAddress, TokenMessenger_ABI, wallet);

    // 1. Convert amount to 6-decimal units (USDC decimals on EVM)
    const amountWei = ethers.parseUnits(amount, 6);

    // 2. Check Allowance
    const allowance = await usdcContract.allowance(wallet.address, TokenMessengerAddress);
    if (allowance < amountWei) {
      console.log(`USDC allowance too low. Approving TokenMessenger to spend ${amount} USDC...`);
      const approveTx = await usdcContract.approve(TokenMessengerAddress, amountWei);
      await approveTx.wait();
      console.log("Approval transaction confirmed:", approveTx.hash);
    }

    // 3. Encode Stellar CctpForwarder address as bytes32
    const rawForwarderBytes = StrKey.decodeContract(STELLAR_CCTP_FORWARDER);
    const mintRecipient = "0x" + rawForwarderBytes.toString("hex");
    const destinationCaller = mintRecipient; // CctpForwarder must be the only allowed caller on destination

    // 4. Construct Hook Data containing final Stellar G-Address
    const hookData = buildCctpForwarderHookData(destStellarPublicKey);

    // Stellar CCTP domain ID is 27
    const destinationDomain = 27;

    console.log(`Executing depositForBurnWithHook of ${amount} USDC to CctpForwarder for recipient ${destStellarPublicKey}...`);
    
    // 5. Execute Burn with Hook
    // depositForBurnWithHook(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, hookData)
    const burnTx = await tokenMessenger.depositForBurnWithHook(
      amountWei,
      destinationDomain,
      mintRecipient,
      USDCAddress,
      destinationCaller,
      0, // maxFee
      0, // minFinalityThreshold (uses default)
      hookData
    );
    
    const receipt = await burnTx.wait();
    console.log("Burn transaction confirmed:", burnTx.hash);

    // 6. Extract CCTP Message Bytes and Hash from logs to poll and submit
    const { messageBytes, messageHash } = extractMessageBytesAndHash(receipt);
    
    return {
      txHash: burnTx.hash,
      messageHash,
      messageBytes
    };
  } catch (error: any) {
    console.error("Failed in burnUSDCForCCTP:", error.message);
    throw error;
  }
}

/**
 * Helper to extract CCTP message bytes and hash from transaction receipt events.
 * Circle's MessageTransmitter emits a MessageSent(bytes message) event.
 */
function extractMessageBytesAndHash(receipt: ethers.TransactionReceipt): { messageBytes: string; messageHash: string } {
  // Topic for MessageSent(bytes message)
  // keccak256("MessageSent(bytes)") = 0x8c5261668696ce22758910d05bab898903e6946f0ea497d3368e907d79de8f5d
  const messageSentTopic = "0x8c5261668696ce22758910d05bab898903e6946f0ea497d3368e907d79de8f5d";
  
  for (const log of receipt.logs) {
    if (log.topics[0] === messageSentTopic) {
      // Decode the bytes parameter from event log
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], log.data);
      const messageBytes = decoded[0]; // Hex string starting with 0x
      const messageHash = ethers.keccak256(messageBytes);
      return { messageBytes, messageHash };
    }
  }
  
  throw new Error("CCTP MessageSent event log not found in transaction receipt.");
}

/**
 * Submits the CCTP attestation and message to the Base EVM MessageTransmitter contract to mint USDC on EVM.
 * Returns the final EVM transaction hash.
 */
export async function receiveMessageOnEVM(
  privateKey: string,
  messageBytesHex: string,
  attestationHex: string
): Promise<string> {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const messageTransmitter = new ethers.Contract(MessageTransmitterAddress, MessageTransmitter_ABI, wallet);

    // Ensure hex starts with 0x
    const messageBytes = messageBytesHex.startsWith("0x") ? messageBytesHex : "0x" + messageBytesHex;
    const attestationBytes = attestationHex.startsWith("0x") ? attestationHex : "0x" + attestationHex;

    console.log(`Executing receiveMessage on EVM MessageTransmitter...`);
    
    // receiveMessage(bytes message, bytes attestation)
    const tx = await messageTransmitter.receiveMessage(messageBytes, attestationBytes);
    
    const receipt = await tx.wait();
    console.log("Receive message transaction confirmed on EVM:", tx.hash);

    return tx.hash;
  } catch (error: any) {
    console.error("Failed in receiveMessageOnEVM:", error.message);
    throw error;
  }
}
