import { Networks } from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import { networkStorage } from "./network-context";

dotenv.config();

export const config = {
  get isMainnet(): boolean {
    const active = networkStorage.getStore();
    if (active) return active === "MAINNET";
    return process.env.STELLAR_NETWORK === "MAINNET";
  },
  
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.6-sol",
  openaiMiniModel: process.env.OPENAI_MINI_MODEL || "gpt-5.6-luna",
  openaiVectorStoreId: process.env.OPENAI_VECTOR_STORE_ID || "",
  
  // Stellar configurations
  get stellarHorizonUrl(): string {
    return this.isMainnet 
      ? (process.env.STELLAR_HORIZON_URL || "https://horizon.stellar.org")
      : (process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org");
  },
    
  get stellarRpcUrl(): string {
    return this.isMainnet
      ? (process.env.STELLAR_RPC_URL || "https://mainnet.sorobanrpc.com")
      : (process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org");
  },
    
  get stellarPassphrase(): string {
    return this.isMainnet ? Networks.PUBLIC : Networks.TESTNET;
  },
  
  stellarUsdcCode: "USDC",
  get stellarUsdcIssuer(): string {
    return this.isMainnet
      ? "GA5ZSESTVFBGGTYJ356JNGJ27J6CRZ5RUCXWVK24K7UJUS5QFE72VT7L"
      : (process.env.USDC_ISSUER_ADDRESS || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  },
    
  get stellarCctpForwarder(): string {
    return this.isMainnet
      ? "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T"
      : "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ";
  },
    
  get stellarTokenMessenger(): string {
    return this.isMainnet
      ? "CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL"
      : "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP";
  },

  get explorerUrlStellar(): string {
    return this.isMainnet 
      ? "https://stellarchain.io/tx/"
      : "https://testnet.stellarchain.io/tx/";
  },
    
  get explorerUrlStellarContract(): string {
    return this.isMainnet
      ? "https://stellarchain.io/address/"
      : "https://testnet.stellarchain.io/address/";
  },

  // Mainnet/Testnet ZK contract mappings
  get confidentialVerifier(): string {
    return process.env.CONFIDENTIAL_VERIFIER_CONTRACT || 
      (this.isMainnet ? "" : "CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL");
  },
  get confidentialAuditor(): string {
    return process.env.CONFIDENTIAL_AUDITOR_CONTRACT || 
      (this.isMainnet ? "" : "CA4II62E35TQKPGHCPBD6EBAS732GSGS6H37UUWKEDHR4YTBVMPHVY4L");
  },
  get confidentialToken(): string {
    return process.env.CONFIDENTIAL_TOKEN_CONTRACT || 
      (this.isMainnet ? "" : "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F");
  }
};
