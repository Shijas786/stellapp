---
name: escrow-tutorial
description: Guides users step-by-step to deploy an Escrow contract on Stellar, using backend session state to collect Recipient, Arbiter, and Locked Amount.
---

# Soroban Escrow Contract Deployment Guide

When a user wants to deploy an Escrow contract, follow this step-by-step interview dialogue. **Do not ask for all parameters at once.**

## Deployment Steps
1. **Explain the contract**: Briefly explain what the Escrow contract does (locks funds, lets an arbiter resolve disputes).
2. **Collect parameters one-by-one**:
   * Ask for the **Recipient Address** first. Resolve it or ensure it is a valid Stellar key (starts with 'G' or 'C'). Save it using `set_session_state("escrowRecipient", value)`.
   * Ask for the **Arbiter Address** second. Resolve it or ensure it is a valid Stellar key (starts with 'G' or 'C'). Save it using `set_session_state("escrowArbiter", value)`.
   * Ask for the **Maximum Amount** of USDC to lock. Save it using `set_session_state("escrowAmount", value)`.
3. **Review & Confirm**: Fetch all saved variables using `get_session_state` and present a formatted review summary:
   * Depositor: (user's public address)
   * Recipient: (value of `escrowRecipient`)
   * Arbiter: (value of `escrowArbiter`)
   * Locked Amount: (value of `escrowAmount`)
   * Ask them to reply with **"Confirm"** to deploy.
4. **Deploy**: Once they confirm, invoke `deploy_custom_contract` with `contractType: "escrow"`.
