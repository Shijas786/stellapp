const fs = require('fs');

const vk = JSON.parse(fs.readFileSync('circuits/verification_key.json'));

function hexToBytes(decStr, numBytes) {
    let hex = BigInt(decStr).toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    while(hex.length < numBytes * 2) hex = '0' + hex; 
    const bytes = [];
    for(let i=0; i<hex.length; i+=2) {
        bytes.push('0x' + hex.substring(i, i+2));
    }
    return bytes;
}

function g1ToRust(arr) {
    const xBytes = hexToBytes(arr[0], 48);
    const yBytes = hexToBytes(arr[1], 48);
    // Note: uncompressed G1 adds the "compression flag" or something?
    // Actually, in arkworks uncompressed, the top bits of x indicate infinity/compression.
    // Assuming snarkjs outputs standard affine, we might need to set the uncompressed flag if Soroban expects it.
    // Wait, let's just combine x and y.
    return `G1Affine::from_bytes(BytesN::from_array(env, &[${xBytes.join(', ')}, ${yBytes.join(', ')}]))`;
}

function g2ToRust(arr) {
    // G2 coordinates are elements of Fq2. Fq2 = c0 + c1 * u
    // In snarkjs: [ [c1, c0], [c1, c0] ] ? Actually snarkjs G2 format is [ [x0, x1], [y0, y1] ] but it might be [ [c0, c1], ... ] or [ [c1, c0], ... ]
    // Wait, the arkworks serialization for Fq2 is c0 then c1.
    // Snarkjs uses [x_real, x_imaginary]. In Ethereum/Snarkjs, G2 is x = x0 + x1 * u. Snarkjs outputs [x1, x0].
    // Let's assume arkworks expects c0 then c1. So we reverse them: [x0, x1].
    // Let's just try to output the 192 bytes. We'll output x_c0, x_c1, y_c0, y_c1.
    // Snarkjs: arr[0][0] is x_c1, arr[0][1] is x_c0. (SnarkJS format is swapped compared to Zcash/Arkworks).
    // Let's swap them.
    const x1 = hexToBytes(arr[0][0], 48); // x_c1
    const x0 = hexToBytes(arr[0][1], 48); // x_c0
    
    const y1 = hexToBytes(arr[1][0], 48);
    const y0 = hexToBytes(arr[1][1], 48);
    
    // Arkworks serializes c0 then c1.
    return `G2Affine::from_bytes(BytesN::from_array(env, &[${x0.join(', ')}, ${x1.join(', ')}, ${y0.join(', ')}, ${y1.join(', ')}]))`;
}

const icItems = vk.IC.map(g => g1ToRust(g)).join(',\n            ');

const rustCode = `
#![no_std]
use soroban_sdk::{vec, BytesN, Env, Vec, contracttype, crypto::bls12_381::{G1Affine, G2Affine}};

#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

pub fn get_vk(env: &Env) -> VerificationKey {
    VerificationKey {
        alpha: ${g1ToRust(vk.vk_alpha_1)},
        beta: ${g2ToRust(vk.vk_beta_2)},
        gamma: ${g2ToRust(vk.vk_gamma_2)},
        delta: ${g2ToRust(vk.vk_delta_2)},
        ic: vec![
            env,
            ${icItems}
        ],
    }
}
`;

fs.writeFileSync('contracts/privacy_pool/contracts/pool/src/vk.rs', rustCode);
console.log("Successfully generated vk.rs!");
