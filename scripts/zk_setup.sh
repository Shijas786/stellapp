#!/bin/bash
set -e

echo "Compiling Privacy Pool Circuit for BLS12-381..."
# Compile the circuit targeting bls12381 (Crucial for Stellar Soroban)
~/.cargo/bin/circom circuits/privacy_pool.circom --r1cs --wasm -p bls12381 -o circuits/

cd circuits

echo "Generating Powers of Tau for BLS12-381..."
# New powers of tau for BLS12-381 (12 is enough for our small circuit)
npx snarkjs powersoftau new bls12-381 12 pot12_0000.ptau -v
npx snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="Stellapp Hackathon" -e="randomness123456789"
npx snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v

echo "Generating ZKey for Privacy Pool..."
# Generate zkey (setup)
npx snarkjs groth16 setup privacy_pool.r1cs pot12_final.ptau privacy_pool.zkey
# Contribute to phase 2
npx snarkjs zkey contribute privacy_pool.zkey privacy_pool_final.zkey --name="Stellapp Contributor" -e="more_randomness"
# Export Verification Key
npx snarkjs zkey export verificationkey privacy_pool_final.zkey verification_key.json

echo "Done! Generated circuits/privacy_pool_final.zkey and circuits/verification_key.json"
