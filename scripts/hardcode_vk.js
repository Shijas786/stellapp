const fs = require('fs');

const vk = JSON.parse(fs.readFileSync('circuits/verification_key.json'));

function formatG1(arr) {
    return `G1Affine { x: Fr::from_bytes([${hexToBytes(arr[0])}]), y: Fr::from_bytes([${hexToBytes(arr[1])}]) }`;
}

function formatG2(arr) {
    return `G2Affine { 
        x: (Fr::from_bytes([${hexToBytes(arr[0][0])}]), Fr::from_bytes([${hexToBytes(arr[0][1])}])), 
        y: (Fr::from_bytes([${hexToBytes(arr[1][0])}]), Fr::from_bytes([${hexToBytes(arr[1][1])}])) 
    }`;
}

function hexToBytes(decStr) {
    let hex = BigInt(decStr).toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    while(hex.length < 96) hex = '0' + hex; // 48 bytes for BLS12-381 Fr
    const bytes = [];
    for(let i=0; i<hex.length; i+=2) {
        bytes.push('0x' + hex.substring(i, i+2));
    }
    return bytes.join(', ');
}

// Just checking if I can do this cleanly in JS to inject it.
