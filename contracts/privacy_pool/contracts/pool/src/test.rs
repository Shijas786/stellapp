#![cfg(test)]

use super::*;
use soroban_sdk::{Env, Address, xdr::ToXdr, BytesN, testutils::Address as _};

#[test]
fn test_address_xdr_lengths() {
    let env = Env::default();
    
    // Test Real Account Address
    let account = Address::from_str(&env, "GDC7ZTYTWA6L4QLL4CB7NFACXQZ5SJ76YMYBKJTSJMP3SDA46ZDVC5SD");
    let account_xdr = account.to_xdr(&env);
    
    // Test Contract Address
    let contract_id = env.register(PrivacyPool, ());
    let contract_xdr = contract_id.to_xdr(&env);

    let mut acc_bytes = [0u8; 44];
    account_xdr.copy_into_slice(&mut acc_bytes);
    
    let mut con_bytes = [0u8; 40];
    contract_xdr.copy_into_slice(&mut con_bytes);

    // Extract payload from account address
    let mut to_payload = [0u8; 32];
    if account_xdr.len() == 44 {
        account_xdr.slice(12..44).copy_into_slice(&mut to_payload);
    } else {
        panic!("Account XDR length is not 44");
    }
    
    // Extract payload from contract address
    let mut contract_payload = [0u8; 32];
    if contract_xdr.len() == 40 {
        contract_xdr.slice(8..40).copy_into_slice(&mut contract_payload);
    } else {
        panic!("Contract XDR length is not 40");
    }

    assert_ne!(to_payload, [0u8; 32]);
    assert_ne!(contract_payload, [0u8; 32]);
}

#[test]
fn test_vk_points_valid() {
    let env = Env::default();
    // If we reach here, it means vk successfully deserialized.
    let vk = get_vk(&env);
    let bls = env.crypto().bls12_381();
    let vp1 = vec![&env, vk.alpha];
    let vp2 = vec![&env, vk.beta];
    let _ = bls.pairing_check(vp1, vp2);
}
