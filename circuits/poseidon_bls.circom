pragma circom 2.1.6;
include "../node_modules/circomlib/circuits/poseidon.circom";

template PoseidonHashers() {
    signal input inputs2[2];
    signal input inputs1[1];
    
    signal output out2;
    signal output out1;
    
    component hasher2 = Poseidon(2);
    hasher2.inputs[0] <== inputs2[0];
    hasher2.inputs[1] <== inputs2[1];
    out2 <== hasher2.out;
    
    component hasher1 = Poseidon(1);
    hasher1.inputs[0] <== inputs1[0];
    out1 <== hasher1.out;
}

component main = PoseidonHashers();
