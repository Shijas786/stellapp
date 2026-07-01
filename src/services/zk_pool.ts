// @ts-ignore
import { buildPoseidon } from 'circomlibjs';
// @ts-ignore
import * as snarkjs from 'snarkjs';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

let poseidon: any;

export async function initPoseidon() {
    if (!poseidon) {
        poseidon = await buildPoseidon();
    }
}

export function bufferToBigInt(buf: Buffer): bigint {
    let res = 0n;
    for (let i = 0; i < buf.length; i++) {
        res = (res << 8n) + BigInt(buf[i]);
    }
    return res;
}

export async function generateDeposit() {
    await initPoseidon();
    
    // 1. Generate random secret & nullifier
    const secretBuf = crypto.randomBytes(31);
    const nullifierBuf = crypto.randomBytes(31);

    const secret = bufferToBigInt(secretBuf);
    const nullifier = bufferToBigInt(nullifierBuf);

    // 2. Compute commitment = Poseidon(nullifier, secret)
    const commitmentHash = poseidon([nullifier, secret]);
    const commitmentStr = poseidon.F.toString(commitmentHash);
    
    return {
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        commitment: commitmentStr
    };
}

export async function recomputeCommitment(secret: string, nullifier: string): Promise<string> {
    await initPoseidon();
    const hash = poseidon([BigInt(nullifier), BigInt(secret)]);
    return poseidon.F.toString(hash);
}

export async function computeRoot(commitmentStr: string, pathElements: string[]): Promise<string> {
    await initPoseidon();
    let current = BigInt(commitmentStr);
    for (let i = 0; i < pathElements.length; i++) {
        // Since pathIndices are 0, we always hash(current, pathElements[i])
        current = poseidon([current, BigInt(pathElements[i])]);
    }
    return poseidon.F.toString(current);
}

export async function generateWithdrawProof(
    secret: string,
    nullifier: string,
    root: string,
    pathElements: string[],
    pathIndices: string[],
    recipientAddressStr: string
) {
    await initPoseidon();
    
    const wasmPath = path.join(__dirname, "../../circuits/privacy_pool_js/privacy_pool.wasm");
    const zkeyPath = path.join(__dirname, "../../circuits/privacy_pool_final.zkey");
    
    // Bind recipient (simple hash/num of string for demo)
    const recipientNum = bufferToBigInt(Buffer.from(recipientAddressStr.slice(0, 31))).toString();

    const input = {
        root,
        nullifierHash: poseidon.F.toString(poseidon([BigInt(nullifier)])),
        recipient: recipientNum,
        secret,
        nullifier,
        pathElements,
        pathIndices
    };

    console.log("[ZK] Generating Groth16 proof...");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
    console.log("[ZK] Proof generated successfully!");

    return { proof, publicSignals, nullifierHash: input.nullifierHash };
}
