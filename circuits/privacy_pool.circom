pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Merkle tree checker
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component selectors[levels];
    component hashers[levels];

    signal currentHash[levels + 1];
    currentHash[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== currentHash[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i].out[0];
        hashers[i].inputs[1] <== selectors[i].out[1];

        currentHash[i + 1] <== hashers[i].out;
    }

    root === currentHash[levels];
}

template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0])*s + in[0];
    out[1] <== (in[0] - in[1])*s + in[1];
}

template PrivacyPool(levels) {
    // Public inputs
    signal input root;
    signal input nullifierHash;
    signal input recipient; // Bound to the withdrawal address to prevent frontrunning
    
    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 1. Calculate commitment: H(nullifier, secret)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== nullifier;
    leafHasher.inputs[1] <== secret;
    
    // 2. Verify commitment is in the Merkle Tree
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== leafHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // 3. Verify nullifier hash: H(nullifier)
    component nullHasher = Poseidon(1);
    nullHasher.inputs[0] <== nullifier;
    nullifierHash === nullHasher.out;

    // 4. Square the recipient to bind it to the proof (dummy constraint so it's part of R1CS)
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

// 4-level tree allows up to 16 deposits (perfect for a demo)
component main { public [root, nullifierHash, recipient] } = PrivacyPool(4);
