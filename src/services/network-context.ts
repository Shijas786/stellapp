import { AsyncLocalStorage } from "async_hooks";

export const networkStorage = new AsyncLocalStorage<"TESTNET" | "MAINNET">();
