// @ts-ignore
import * as snarkjs from 'snarkjs';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Address, StrKey } from '@stellar/stellar-sdk';

const BLS12_381_R = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;
const STELLAR_ACCOUNT_TAG = 1n;
const STELLAR_CONTRACT_TAG = 2n;
const CANONICAL_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;

interface WitnessCalculator {
    calculateWitness(input: Record<string, unknown>, sanityCheck: number): Promise<Array<string | bigint>>;
}

let witnessCalculator: WitnessCalculator | null = null;
let out1Index: number = -1;
let out2Index: number = -1;
let initPromise: Promise<void> | null = null;

function parseCanonicalField(value: string | bigint, name: string): bigint {
    let parsed: bigint;

    if (typeof value === 'bigint') {
        parsed = value;
    } else {
        const clean = value.trim();
        if (clean.startsWith('0x')) {
            if (!/^0x[0-9a-fA-F]+$/.test(clean)) {
                throw new TypeError(`${name} must be a valid 0x-prefixed hex string`);
            }
            parsed = BigInt(clean);
        } else if (/^[0-9a-fA-F]{64}$/.test(clean)) {
            // Handle raw 64-character hex strings from database
            parsed = BigInt('0x' + clean);
        } else if (/^(0|[1-9][0-9]*)$/.test(clean)) {
            parsed = BigInt(clean);
        } else {
            throw new TypeError(`${name} must be a canonical unsigned decimal or hex field element`);
        }
    }

    if (parsed < 0n || parsed >= BLS12_381_R) {
        throw new RangeError(`${name} must be in the range [0, BLS12_381_R)`);
    }

    return parsed;
}

function canonicalField(value: string | bigint, name: string): string {
    return parseCanonicalField(value, name).toString();
}

function parseWitnessIndex(value: string | undefined, signalName: string): number {
    if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new Error(`Invalid witness index for ${signalName}`);
    }

    const index = Number(value);
    if (!Number.isSafeInteger(index) || index < 0) {
        throw new Error(`Invalid witness index for ${signalName}`);
    }

    return index;
}

function getWitnessOutput(
    witness: Array<string | bigint>,
    index: number,
    signalName: string
): string {
    if (!Array.isArray(witness) || index < 0 || index >= witness.length) {
        throw new Error(`Witness output ${signalName} is missing`);
    }

    return canonicalField(witness[index], `witness output ${signalName}`);
}

export async function initPoseidon(): Promise<void> {
    if (witnessCalculator && out1Index >= 0 && out2Index >= 0) {
        return;
    }

    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        const calculatorPath = path.join(
            process.cwd(),
            'circuits/poseidon_bls_js/witness_calculator.js'
        );
        const wasmPath = path.join(
            process.cwd(),
            'circuits/poseidon_bls_js/poseidon_bls.wasm'
        );
        const symPath = path.join(process.cwd(), 'circuits/poseidon_bls.sym');

        const wc = require(calculatorPath);
        if (typeof wc !== 'function') {
            throw new Error('Invalid Poseidon witness calculator module');
        }

        const wasmBuffer = fs.readFileSync(wasmPath);
        const calculator = await wc(wasmBuffer);

        if (!calculator || typeof calculator.calculateWitness !== 'function') {
            throw new Error('Poseidon witness calculator failed to initialize');
        }

        const symContent = fs.readFileSync(symPath, 'utf-8');
        let initializedOut1Index = -1;
        let initializedOut2Index = -1;

        for (const line of symContent.split(/\r?\n/)) {
            if (!line.trim()) continue;

            const parts = line.split(',');
            if (parts.length < 4) continue;

            const name = parts[3].trim();
            if (name === 'main.out1') {
                initializedOut1Index = parseWitnessIndex(parts[1]?.trim(), name);
            } else if (name === 'main.out2') {
                initializedOut2Index = parseWitnessIndex(parts[1]?.trim(), name);
            }
        }

        if (
            initializedOut1Index < 0 ||
            initializedOut2Index < 0 ||
            initializedOut1Index === initializedOut2Index
        ) {
            throw new Error('Required Poseidon output signals were not found');
        }

        witnessCalculator = calculator as WitnessCalculator;
        out1Index = initializedOut1Index;
        out2Index = initializedOut2Index;
    })().catch((error) => {
        witnessCalculator = null;
        out1Index = -1;
        out2Index = -1;
        initPromise = null;
        throw error;
    });

    return initPromise;
}

export async function poseidon1(x: string | bigint): Promise<string> {
    await initPoseidon();

    if (!witnessCalculator) {
        throw new Error('Poseidon witness calculator is not initialized');
    }

    const input = {
        inputs2: ['0', '0'],
        inputs1: [canonicalField(x, 'Poseidon input')]
    };
    const witness = await witnessCalculator.calculateWitness(input, 0);
    return getWitnessOutput(witness, out1Index, 'main.out1');
}

async function poseidon2(x: string | bigint, y: string | bigint): Promise<string> {
    await initPoseidon();

    if (!witnessCalculator) {
        throw new Error('Poseidon witness calculator is not initialized');
    }

    const input = {
        inputs2: [
            canonicalField(x, 'first Poseidon input'),
            canonicalField(y, 'second Poseidon input')
        ],
        inputs1: ['0']
    };
    const witness = await witnessCalculator.calculateWitness(input, 0);
    return getWitnessOutput(witness, out2Index, 'main.out2');
}

export function bufferToBigInt(buf: Buffer): bigint {
    let res = 0n;
    for (let i = 0; i < buf.length; i++) {
        res = (res << 8n) + BigInt(buf[i]);
    }
    return res;
}

function splitAddressPayload(payload: Buffer): { hi: bigint; lo: bigint } {
    if (payload.length !== 32) {
        throw new Error('Stellar address payload must be exactly 32 bytes');
    }

    return {
        hi: bufferToBigInt(payload.subarray(0, 16)),
        lo: bufferToBigInt(payload.subarray(16, 32))
    };
}

async function encodeRecipientAddress(recipientAddressStr: string): Promise<string> {
    if (
        typeof recipientAddressStr !== 'string' ||
        recipientAddressStr.length === 0 ||
        recipientAddressStr.trim() !== recipientAddressStr
    ) {
        throw new TypeError('Recipient must be a canonical Stellar address');
    }

    let canonicalAddress: string;
    try {
        canonicalAddress = Address.fromString(recipientAddressStr).toString();
    } catch {
        throw new TypeError('Recipient must be a valid Stellar account or contract address');
    }

    if (canonicalAddress !== recipientAddressStr) {
        throw new TypeError('Recipient must be a canonical Stellar address');
    }

    let typeTag: bigint;
    let payload: Buffer;

    if (recipientAddressStr.startsWith('G')) {
        typeTag = STELLAR_ACCOUNT_TAG;
        payload = Buffer.from(StrKey.decodeEd25519PublicKey(recipientAddressStr));
    } else if (recipientAddressStr.startsWith('C')) {
        typeTag = STELLAR_CONTRACT_TAG;
        payload = Buffer.from(StrKey.decodeContract(recipientAddressStr));
    } else {
        throw new TypeError('Recipient address type is not supported');
    }

    const { hi, lo } = splitAddressPayload(payload);

    // Bind the complete address without lossy modular reduction:
    // Poseidon(typeTag, Poseidon(high 128-bit limb, low 128-bit limb)).
    const encodedPayload = await poseidon2(hi, lo);
    return poseidon2(typeTag, encodedPayload);
}

export async function generateDeposit() {
    await initPoseidon();

    // 1. Generate random secret & nullifier
    const secretBuf = crypto.randomBytes(31);
    const nullifierBuf = crypto.randomBytes(31);

    const secret = bufferToBigInt(secretBuf);
    const nullifier = bufferToBigInt(nullifierBuf);

    // 2. Compute commitment = Poseidon(nullifier, secret)
    const commitmentStr = await poseidon2(nullifier, secret);

    return {
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        commitment: commitmentStr
    };
}

export async function recomputeCommitment(
    secret: string,
    nullifier: string
): Promise<string> {
    return poseidon2(
        canonicalField(nullifier, 'nullifier'),
        canonicalField(secret, 'secret')
    );
}

export async function computeRoot(
    commitmentStr: string,
    pathElements: string[],
    pathIndices: string[]
): Promise<string> {
    await initPoseidon();

    if (pathElements.length !== pathIndices.length) {
        throw new Error('Merkle path elements and indices must have equal lengths');
    }

    let current = canonicalField(commitmentStr, 'commitment');

    for (let i = 0; i < pathElements.length; i++) {
        const sibling = canonicalField(pathElements[i], `pathElements[${i}]`);
        const pathIndex = pathIndices[i];

        if (pathIndex !== '0' && pathIndex !== '1') {
            throw new TypeError(`pathIndices[${i}] must be "0" or "1"`);
        }

        const isRight = pathIndex === '1';
        if (isRight) {
            current = await poseidon2(sibling, current);
        } else {
            current = await poseidon2(current, sibling);
        }
    }

    return current;
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

    const wasmPath = path.join(
        process.cwd(),
        'circuits/privacy_pool_js/privacy_pool.wasm'
    );
    const zkeyPath = path.join(
        process.cwd(),
        'circuits/privacy_pool_final.zkey'
    );

    if (pathElements.length !== pathIndices.length) {
        throw new Error('Merkle path elements and indices must have equal lengths');
    }

    const canonicalSecret = canonicalField(secret, 'secret');
    const canonicalNullifier = canonicalField(nullifier, 'nullifier');
    const canonicalRoot = canonicalField(root, 'root');

    const decimalPathElements = pathElements.map((element, index) =>
        canonicalField(element, `pathElements[${index}]`)
    );

    const canonicalPathIndices = pathIndices.map((index, position) => {
        if (index !== '0' && index !== '1') {
            throw new TypeError(`pathIndices[${position}] must be "0" or "1"`);
        }
        return index;
    });

    // Decode the Stellar address to raw 32-byte payload and split it into hi and lo limbs
    let payload: Buffer;
    if (recipientAddressStr.startsWith('G')) {
        payload = Buffer.from(StrKey.decodeEd25519PublicKey(recipientAddressStr));
    } else if (recipientAddressStr.startsWith('C')) {
        payload = Buffer.from(StrKey.decodeContract(recipientAddressStr));
    } else {
        throw new TypeError('Recipient address type is not supported');
    }

    const { hi, lo } = splitAddressPayload(payload);
    const nullifierHash = await poseidon1(canonicalNullifier);

    const input = {
        root: canonicalRoot,
        nullifierHash,
        recipient_hi: hi.toString(),
        recipient_lo: lo.toString(),
        secret: canonicalSecret,
        nullifier: canonicalNullifier,
        pathElements: decimalPathElements,
        pathIndices: canonicalPathIndices
    };

    console.log('[ZK] Generating Groth16 proof...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasmPath,
        zkeyPath
    );
    console.log('[ZK] Proof generated successfully!');

    return { proof, publicSignals, nullifierHash };
}