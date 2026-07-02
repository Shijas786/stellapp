import { Keypair, TransactionBuilder, Operation, Asset, Networks } from "stellar-sdk";

const sender = Keypair.random();
const receiver = Keypair.random();

console.log("Syntax is valid if this compiles!");
