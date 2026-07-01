import { Networks } from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

const IS_MAINNET = process.env.STELLAR_NETWORK === "MAINNET";

export const config = {
  isMainnet: IS_MAINNET,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  
  // Stellar configurations
  stellarHorizonUrl: IS_MAINNET 
    ? (process.env.STELLAR_HORIZON_URL || "https://horizon.stellar.org")
    : (process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org"),
    
  stellarRpcUrl: IS_MAINNET
    ? (process.env.STELLAR_RPC_URL || "https://soroban-rpc.stellar.org")
    : (process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org"),
    
  stellarPassphrase: IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET,
  
  stellarUsdcCode: "USDC",
  stellarUsdcIssuer: IS_MAINNET
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : (process.env.USDC_ISSUER_ADDRESS || "GBBD4QNSTNAA2MA2LIADO57IL3ZCYCVW27566TC4H7SV23R3CQDU4VE3"),
    
  stellarCctpForwarder: IS_MAINNET
    ? "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T"
    : "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",

  // EVM configurations (Base Mainnet vs Base Sepolia)
  evmRpcUrl: IS_MAINNET
    ? (process.env.EVM_RPC_URL || "https://mainnet.base.org")
    : (process.env.EVM_RPC_URL || "https://sepolia.base.org"),
    
  evmChainId: IS_MAINNET ? 8453 : 84532,
  
  evmUsdcAddress: IS_MAINNET
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    
  evmCctpTokenMessenger: IS_MAINNET
    ? "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"
    : "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",

  // Circle CCTP API configurations
  circleApiUrl: IS_MAINNET
    ? "https://iris-api.circle.com"
    : (process.env.CIRCLE_API_URL || "https://iris-api-sandbox.circle.com"),
    
  explorerUrlStellar: IS_MAINNET 
    ? "https://stellar.expert/explorer/public/tx/"
    : "https://stellar.expert/explorer/testnet/tx/",
    
  explorerUrlStellarContract: IS_MAINNET
    ? "https://stellar.expert/explorer/public/contract/"
    : "https://stellar.expert/explorer/testnet/contract/",
    
  explorerUrlBase: IS_MAINNET
    ? "https://basescan.org/tx/"
    : "https://sepolia.basescan.org/tx/"
};
