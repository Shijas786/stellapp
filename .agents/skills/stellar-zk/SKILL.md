---
name: stellar-zk
description: Guidelines and references for building privacy-preserving zero-knowledge proof verifiers on Stellar using BLS12-381, BN254, and Poseidon primitives.
---

# 🌌 Zero-Knowledge Proofs & Privacy on Stellar

Guidelines for verifying zk-SNARKs and using ZK-friendly primitives in Soroban smart contracts.

---

## 🔑 Cryptographic Primitives & curve Status

Stellar Protocol 25 (X-Ray) and Protocol 26 (Yardstick) introduced native, cheap, and gas-efficient host functions for ZK curves:

| Curve / Primitive | CAP | Protocol Version | Host Functions | On-Chain Status |
| :--- | :--- | :---: | :--- | :--- |
| **BLS12-381** | [CAP-0059](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md) | 22+ | G1 add, G1 mul, Pairing Check, hash-to-curve | ✅ Available |
| **BN254** | [CAP-0074](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md) | 25+ | `g1_add`, `g1_mul`, `pairing_check` | ✅ Available |
| **Poseidon / Poseidon2** | [CAP-0075](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0075.md) | 25+ | `poseidon`, `poseidon2` hashes | ✅ Available |

---

## 🛠️ Toolchain to Stellar Mapping

*   **Circom + snarkjs (`-p bls12381`)**: Verifies Groth16 proofs natively on-chain today using BLS12-381 primitives.
*   **Circom (default BN254)**: Verifies Groth16 proofs natively on-chain today using Protocol 25/26 BN254 host functions.
*   **Noir + Barretenberg**: Aztec's Noir toolchain compiles to **UltraHonk** proofs over the BN254 curve, verified efficiently using the Soroban BN254 primitives.
*   **RISC Zero zkVM**: Write provable execution loops in ordinary Rust, wrap to Groth16, and verify on-chain using the RISC Zero verifier contract.

---

## 📝 Soroban Canonical Groth16 Verifier Template (Rust)

A standard implementation of a Groth16 pairing check verifier in Soroban:

```rust
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    vec, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    MalformedVerifyingKey = 0,
}

#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    pub fn verify_proof(
        env: Env,
        vk: VerificationKey,
        proof: Proof,
        pub_signals: Vec<Fr>,
    ) -> Result<bool, Groth16Error> {
        let bls = env.crypto().bls12_381();

        // Check verification input length
        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(Groth16Error::MalformedVerifyingKey);
        }
        
        // vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
        let mut vk_x = vk.ic.get(0).unwrap();
        for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let prod = bls.g1_mul(&v, &s);
            vk_x = bls.g1_add(&vk_x, &prod);
        }

        // Groth16 pairing equation: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let neg_a = -proof.a;
        let vp1 = vec![&env, neg_a, vk.alpha, vk_x, proof.c];
        let vp2 = vec![&env, proof.b, vk.beta, vk.gamma, vk.delta];

        Ok(bls.pairing_check(vp1, vp2))
    }
}
```

---

## 🔒 Hashing inside circuits (Poseidon)

Use native Poseidon functions to verify hashes inside zk circuits (such as nullifiers or Merkle roots):

```rust
use soroban_sdk::{crypto::poseidon, Env, Vec, Val};

pub fn hash_elements(env: Env, elements: Vec<Val>) -> Val {
    // Poseidon hashes multiple field inputs natively
    env.crypto().poseidon(elements)
}
```

---

## 🛠️ ZK Circuit Tooling & SDK Integration Reference

### 1. Noir (Aztec)
Noir is a Rust-like Domain-Specific Language (DSL) for writing zero-knowledge circuits.
*   **Compile**: `nargo compile`
*   **Generate Proof**: `nargo prove`
*   **Verifier Contract**: Noir circuits verify on-chain on Stellar using UltraHonk proof systems mapped to BN254.

### 2. RISC Zero (zkVM)
A zero-knowledge virtual machine allowing execution of arbitrary compiled Rust code.
*   **Prover**: Executed off-chain, proving the valid execution of a Rust binary.
*   **Attestation**: Generates a receipt containing a cryptographic journal and proof.
*   **Verifier**: A Soroban contract verifies the Groth16-wrapped receipt using BN254 pairing checks.

### 3. Circom
A low-level circuit language representing arithmetic systems.
*   **Compile**: `circom circuit.circom --r1cs --wasm`
*   **Setup**: Use `snarkjs` to perform a trusted setup and export verification keys as JSON vectors (`ic`, `alpha`, `beta`, `gamma`, `delta`).

### 4. SDK APIs & Primitives
*   **BN254 curve types**: `soroban_sdk::crypto::bn254` provides direct mappings for `G1Affine` (96 bytes), `G2Affine` (192 bytes), and `Fr` (32 bytes scalar elements).
*   **Poseidon hashing**: `env.crypto().poseidon(inputs)` accepts up to 16 elements and outputs a single 32-byte hash value.

---

## 🏛️ On-Chain ZK Verifier Reference Implementations

1.  **Nethermind RISC Zero Groth16 Verifier** ([stellar-risc0-verifier](https://github.com/NethermindEth/stellar-risc0-verifier)):
    *   Verifies execution receipts produced by RISC Zero zkVM on-chain.
    *   The STARK execution proof is converted into a Groth16 proof over BN254.
    *   The contract checks the integrity of the journal and validates the Groth16 proof using Soroban BN254 pairing primitives.
2.  **UltraHonk Noir Verifier** ([rs-soroban-ultrahonk](https://github.com/yugocabrio/rs-soroban-ultrahonk) & [ultrahonk_soroban_contract](https://github.com/indextree/ultrahonk_soroban_contract)):
    *   On-chain verifier designed for Noir circuits.
    *   Utilizes the Aztec UltraHonk proof format, reducing verification costs on Protocol 26.
3.  **Nethermind Stellar Private Payments (Privacy Pools)** ([stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments)):
    *   Proof-of-concept for compliant privacy pools.
    *   Utilizes Circom circuits, Groth16 proofs, and Poseidon hashes.
    *   Includes a pool contract, an on-chain Groth16 verifier, and membership trees (allowing users to privately withdraw assets by proving membership in the pool without linking to a specific deposit).


