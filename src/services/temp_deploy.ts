import { prisma } from "./db";
import { decryptForUserWithMigration } from "./encryption";
import * as stellar from "./stellar";

export async function runTempDeploy() {
  try {
    // Check if we already deployed them to avoid duplicates on restarts
    const record = await prisma.sessionState.findUnique({ where: { chatId: "918137956320@c.us" } });
    const state = record ? JSON.parse(record.stateJson) : {};
    if (state.multi_pools_ready) {
      console.log("[Temp Deploy] Multi-denomination pools are already deployed and ready.");
      return;
    }

    console.log("[Temp Deploy] Initializing one-time deployment of 1, 5, 50, and 100 USDC pools...");

    const adminUser = await prisma.user.findFirst({
      where: { chatId: "918137956320@c.us" }
    });
    if (!adminUser) {
      console.error("[Temp Deploy] Admin user not found in DB.");
      return;
    }

    const stellarSecret = decryptForUserWithMigration(adminUser.stellarSecret, adminUser.id).plaintext;
    const denominations = [1, 5, 50, 100];
    const poolMap: Record<number, string> = {};

    for (const denom of denominations) {
      console.log(`[Temp Deploy] Deploying ${denom} USDC ZK Privacy Pool...`);
      const { contractId } = await stellar.deployPrivacyPool(stellarSecret, "USDC", denom.toString());
      console.log(`[Temp Deploy] Successfully deployed ${denom} USDC: ${contractId}`);
      poolMap[denom] = contractId;
    }

    // Save to Admin session state
    state.multi_pools_ready = true;
    for (const denom of denominations) {
      state[`pool_USDC_${denom}`] = poolMap[denom];
    }
    
    // Also update Ummi's session state so she gets the same pool mappings
    const ummiRecord = await prisma.sessionState.findUnique({ where: { chatId: "919946306583@c.us" } });
    const ummiState = ummiRecord ? JSON.parse(ummiRecord.stateJson) : {};
    ummiState.multi_pools_ready = true;
    for (const denom of denominations) {
      ummiState[`pool_USDC_${denom}`] = poolMap[denom];
    }

    await prisma.sessionState.upsert({
      where: { chatId: "918137956320@c.us" },
      create: { chatId: "918137956320@c.us", stateJson: JSON.stringify(state) },
      update: { stateJson: JSON.stringify(state) }
    });

    await prisma.sessionState.upsert({
      where: { chatId: "919946306583@c.us" },
      create: { chatId: "919946306583@c.us", stateJson: JSON.stringify(ummiState) },
      update: { stateJson: JSON.stringify(ummiState) }
    });

    console.log("[Temp Deploy] Successfully deployed all pools and updated session states!");
    console.log("[Temp Deploy] Pool IDs:", JSON.stringify(poolMap));
  } catch (err: any) {
    console.error("[Temp Deploy] Error during deployment:", err.message);
  }
}
