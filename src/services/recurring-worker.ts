import { prisma } from "./db";
import { networkStorage } from "./network-context";
import { swapTokens, sendStellarToken, getCurrentPriceOfXlmInUsdc, getBalances } from "./stellar";
import { getSinglePrice } from "./price";
import { decryptForUserWithMigration } from "./encryption";
import fs from "fs";
import path from "path";

let notificationSender: ((chatId: string, text: string) => Promise<string>) | null = null;
let messageEditor: ((chatId: string, messageId: string, text: string) => Promise<void>) | null = null;
let typingStateSender: ((chatId: string) => Promise<void>) | null = null;

const jobFailures = new Map<string, number>();

export function setRecurringNotificationSender(
  sender: (chatId: string, text: string) => Promise<string>,
  editor: (chatId: string, messageId: string, text: string) => Promise<void>,
  typer: (chatId: string) => Promise<void>
) {
  notificationSender = sender;
  messageEditor = editor;
  typingStateSender = typer;
}

export function startRecurringWorker() {
  console.log("=========================================");
  console.log("[Recurring Worker] Background loop initialized.");
  console.log("=========================================");
  
  let tick = 0;
  let priceTick = 0;
  // Check jobs every 5 seconds
  setInterval(async () => {
    try {
      await processSwapJobs();
      await processTransferJobs();
      await processLimitOrders();
      await processContractWatchers();
      
      // Price alerts hit CoinGecko — only check every 5 minutes (60 * 5s)
      // to stay within 10k monthly credits (~288 calls/day per active alert)
      priceTick++;
      if (priceTick >= 60) {
        priceTick = 0;
        await processCustomAlertJobs();
      }
      
      tick++;
      if (tick >= 12) { // Every 60 seconds (12 * 5s)
        tick = 0;
        await processLowBalances();
      }
    } catch (err: any) {
      console.error("[Recurring Worker] Error in background loop iteration:", err.message);
    }
  }, 5000);
}


async function processSwapJobs() {
  const activeJobs = await prisma.recurringSwapJob.findMany({
    where: { isActive: true }
  });

  for (const job of activeJobs) {
    const nextExecution = new Date(job.lastExecutedAt.getTime() + job.intervalSeconds * 1000);
    if (new Date() >= nextExecution) {
      // Optimistic lock check to prevent multiple instances from processing the same job step
      try {
        const updateResult = await prisma.recurringSwapJob.updateMany({
          where: {
            id: job.id,
            lastExecutedAt: job.lastExecutedAt, // Ensure another worker hasn't updated it yet
            isActive: true
          },
          data: {
            lastExecutedAt: new Date()
          }
        });

        if (updateResult.count === 0) {
          // Locked by another concurrent worker instance
          continue;
        }
      } catch (err) {
        continue;
      }

      try {
        const user = await prisma.user.findFirst({ where: { chatId: job.chatId } });
        if (!user) {
          console.error(`[Recurring Worker] User for job ${job.id} not found.`);
          await prisma.recurringSwapJob.update({
            where: { id: job.id },
            data: { isActive: false }
          });
          continue;
        }

        const secretKey = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
        const direction = job.fromAsset === "USDC" ? "USDC_TO_XLM" : "XLM_TO_USDC";
        
        // Trigger live typing presence indicator
        if (typingStateSender) {
          try {
            await typingStateSender(job.chatId);
          } catch (e) {}
        }

        const sessionRecord = await prisma.sessionState.findUnique({ where: { chatId: job.chatId } });
        let networkMode: "TESTNET" | "MAINNET" = process.env.STELLAR_NETWORK === "MAINNET" ? "MAINNET" : "TESTNET";
        if (sessionRecord) {
          const state = JSON.parse(sessionRecord.stateJson);
          if (state.networkMode === "MAINNET" || state.networkMode === "TESTNET") {
            networkMode = state.networkMode;
          }
        }

        console.log(`[Recurring Worker] Processing swap step for job ${job.id} (User: ${user.stellarPublic}) on ${networkMode}...`);
        const txHash = await networkStorage.run(networkMode, () =>
          swapTokens(secretKey, job.amountPerSwap, direction)
        );
        
        const completed = job.swapsCompleted + 1;
        const total = job.totalSwaps;
        const finished = completed >= total;

        const updatedHashes = job.txHashes ? `${job.txHashes},${txHash}` : txHash;

        await prisma.recurringSwapJob.update({
          where: { id: job.id },
          data: {
            swapsCompleted: completed,
            isActive: !finished,
            txHashes: updatedHashes
          }
        });

        jobFailures.delete(job.id);

        // Edit status message to show live progress
        if (job.statusMessageId && messageEditor) {
          try {
            if (finished) {
              const allHashes = updatedHashes.split(",").filter(Boolean);
              const linksList = allHashes.map((h, i) => `• Swap #${i+1}: https://stellar.expert/explorer/testnet/tx/${h}`).join("\n");
              const progressMsg = `🎉 *DCA Swap Job Completed!* \n\nSuccessfully executed all ${total} swaps of ${job.amountPerSwap} ${job.fromAsset} → ${job.toAsset}.\n\n🔗 *Transaction Links:* \n${linksList}`;
              await messageEditor(job.chatId, job.statusMessageId, progressMsg);
            } else {
              const progressMsg = `⏳ *DCA Swap Progress:* \n\nExecuted swap *${completed}/${total}* of ${job.amountPerSwap} ${job.fromAsset} → ${job.toAsset}.\n\n_(Progress updates live - no notification spam)_`;
              await messageEditor(job.chatId, job.statusMessageId, progressMsg);
            }
          } catch (editErr) {
            console.error(`Failed to edit status message for job ${job.id}:`, editErr);
          }
        } else if (finished && notificationSender) {
          // Fallback if no statusMessageId exists
          const allHashes = updatedHashes.split(",").filter(Boolean);
          const linksList = allHashes.map((h, i) => `• Swap #${i+1}: https://stellar.expert/explorer/testnet/tx/${h}`).join("\n");
          const progressMsg = `🎉 *DCA Swap Job Completed!* \n\nSuccessfully executed all ${total} swaps of ${job.amountPerSwap} ${job.fromAsset} → ${job.toAsset}.\n\n🔗 *Transaction Links:* \n${linksList}`;
          await notificationSender(job.chatId, progressMsg);
        }
      } catch (err: any) {
        console.error(`[Recurring Worker] Swap Job ${job.id} step failed:`, err.message);

        const failures = (jobFailures.get(job.id) || 0) + 1;
        jobFailures.set(job.id, failures);

        if (failures >= 3) {
          await prisma.recurringSwapJob.update({
            where: { id: job.id },
            data: { isActive: false }
          });
          jobFailures.delete(job.id);
          
          if (notificationSender) {
            try {
              await notificationSender(job.chatId, `⚠️ *DCA Swap Terminated:* The scheduled swap job (${job.amountPerSwap} ${job.fromAsset} → ${job.toAsset}) failed 3 consecutive times. \n\n*Last Error:* ${err.message}\n\nPlease check your balance or trustlines and set up a new schedule.`);
            } catch (e) {}
          }
        } else {
          const retryDelay = Math.min(job.intervalSeconds, 60);
          await prisma.recurringSwapJob.update({
            where: { id: job.id },
            data: {
              lastExecutedAt: new Date(Date.now() - (job.intervalSeconds - retryDelay) * 1000)
            }
          });
          
          if (notificationSender) {
            try {
              await notificationSender(job.chatId, `⚠️ *DCA Swap Failed (Attempt ${failures}/3):* ${err.message}. Retrying in 60 seconds.`);
            } catch (e) {}
          }
        }
      }
    }
  }
}

async function processTransferJobs() {
  const activeJobs = await prisma.recurringTransferJob.findMany({
    where: { isActive: true }
  });

  for (const job of activeJobs) {
    const nextExecution = new Date(job.lastExecutedAt.getTime() + job.intervalSeconds * 1000);
    if (new Date() >= nextExecution) {
      // Optimistic lock check to prevent multiple instances from processing the same transfer step
      try {
        const updateResult = await prisma.recurringTransferJob.updateMany({
          where: {
            id: job.id,
            lastExecutedAt: job.lastExecutedAt, // Ensure another worker hasn't updated it yet
            isActive: true
          },
          data: {
            lastExecutedAt: new Date()
          }
        });

        if (updateResult.count === 0) {
          // Locked by another concurrent worker instance
          continue;
        }
      } catch (err) {
        continue;
      }

      try {
        const user = await prisma.user.findFirst({ where: { chatId: job.chatId } });
        if (!user) {
          console.error(`[Recurring Worker] User for transfer job ${job.id} not found.`);
          await prisma.recurringTransferJob.update({
            where: { id: job.id },
            data: { isActive: false }
          });
          continue;
        }

        const secretKey = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
        const isUSDC = job.assetCode === "USDC";

        // Trigger live typing presence indicator
        if (typingStateSender) {
          try {
            await typingStateSender(job.chatId);
          } catch (e) {}
        }

        const sessionRecord = await prisma.sessionState.findUnique({ where: { chatId: job.chatId } });
        let networkMode: "TESTNET" | "MAINNET" = process.env.STELLAR_NETWORK === "MAINNET" ? "MAINNET" : "TESTNET";
        if (sessionRecord) {
          const state = JSON.parse(sessionRecord.stateJson);
          if (state.networkMode === "MAINNET" || state.networkMode === "TESTNET") {
            networkMode = state.networkMode;
          }
        }

        console.log(`[Recurring Worker] Processing transfer step for job ${job.id} (Recipient: ${job.recipientAddr}) on ${networkMode}...`);
        const txHash = await networkStorage.run(networkMode, () =>
          sendStellarToken(secretKey, job.recipientAddr, job.amountPerTransfer, isUSDC)
        );
        
        const completed = job.transfersCompleted + 1;
        const total = job.totalTransfers;
        const finished = completed >= total;

        const updatedHashes = job.txHashes ? `${job.txHashes},${txHash}` : txHash;

        await prisma.recurringTransferJob.update({
          where: { id: job.id },
          data: {
            transfersCompleted: completed,
            isActive: !finished,
            txHashes: updatedHashes
          }
        });

        jobFailures.delete(job.id);

        // Edit status message to show live progress
        if (job.statusMessageId && messageEditor) {
          try {
            const recipientLabel = job.recipientName || job.recipientAddr.slice(0, 8) + "...";
            if (finished) {
              const allHashes = updatedHashes.split(",").filter(Boolean);
              const linksList = allHashes.map((h, i) => `• Transfer #${i+1}: https://stellar.expert/explorer/testnet/tx/${h}`).join("\n");
              const progressMsg = `🎉 *Allowance Payment Completed!* \n\nSuccessfully executed all ${total} payments of ${job.amountPerTransfer} ${job.assetCode} to ${recipientLabel}.\n\n🔗 *Transaction Links:* \n${linksList}`;
              await messageEditor(job.chatId, job.statusMessageId, progressMsg);
            } else {
              const progressMsg = `⏳ *Allowance Progress:* \n\nSent payment *${completed}/${total}* of ${job.amountPerTransfer} ${job.assetCode} to ${recipientLabel}.\n\n_(Progress updates live - no notification spam)_`;
              await messageEditor(job.chatId, job.statusMessageId, progressMsg);
            }
          } catch (editErr) {
            console.error(`Failed to edit status message for transfer job ${job.id}:`, editErr);
          }
        } else if (finished && notificationSender) {
          // Fallback if no statusMessageId exists
          const recipientLabel = job.recipientName || job.recipientAddr.slice(0, 8) + "...";
          const allHashes = updatedHashes.split(",").filter(Boolean);
          const linksList = allHashes.map((h, i) => `• Transfer #${i+1}: https://stellar.expert/explorer/testnet/tx/${h}`).join("\n");
          const progressMsg = `🎉 *Allowance Payment Completed!* \n\nSuccessfully executed all ${total} payments of ${job.amountPerTransfer} ${job.assetCode} to ${recipientLabel}.\n\n🔗 *Transaction Links:* \n${linksList}`;
          await notificationSender(job.chatId, progressMsg);
        }
      } catch (err: any) {
        console.error(`[Recurring Worker] Transfer Job ${job.id} step failed:`, err.message);

        const failures = (jobFailures.get(job.id) || 0) + 1;
        jobFailures.set(job.id, failures);
        const recipientLabel = job.recipientName || job.recipientAddr.slice(0, 8) + "...";

        if (failures >= 3) {
          await prisma.recurringTransferJob.update({
            where: { id: job.id },
            data: { isActive: false }
          });
          jobFailures.delete(job.id);
          
          if (notificationSender) {
            try {
              await notificationSender(job.chatId, `⚠️ *Scheduled Payment Terminated:* The recurring payment of ${job.amountPerTransfer} ${job.assetCode} to ${recipientLabel} failed 3 consecutive times. \n\n*Last Error:* ${err.message}\n\nPlease check your balance and try scheduling again.`);
            } catch (e) {}
          }
        } else {
          const retryDelay = Math.min(job.intervalSeconds, 60);
          await prisma.recurringTransferJob.update({
            where: { id: job.id },
            data: {
              lastExecutedAt: new Date(Date.now() - (job.intervalSeconds - retryDelay) * 1000)
            }
          });
          
          if (notificationSender) {
            try {
              await notificationSender(job.chatId, `⚠️ *Allowance Payment Failed (Attempt ${failures}/3):* ${err.message} to ${recipientLabel}. Retrying in 60 seconds.`);
            } catch (e) {}
          }
        }
      }
    }
  }
}

async function processLimitOrders() {
  const activeOrders = await prisma.limitOrderJob.findMany({
    where: { isActive: true }
  });

  if (activeOrders.length === 0) return;

  try {
    const currentPrice = await getCurrentPriceOfXlmInUsdc();
    
    for (const order of activeOrders) {
      const triggerPriceNum = parseFloat(order.triggerPrice);
      let conditionMet = false;

      if (order.condition === "LESS_THAN_OR_EQUAL") {
        conditionMet = currentPrice <= triggerPriceNum;
      } else if (order.condition === "GREATER_THAN_OR_EQUAL") {
        conditionMet = currentPrice >= triggerPriceNum;
      }

      if (conditionMet) {
        // Optimistic lock to prevent double trigger by concurrent workers
        try {
          const updateResult = await prisma.limitOrderJob.updateMany({
            where: { id: order.id, isActive: true },
            data: { isActive: false }
          });
          if (updateResult.count === 0) continue; // Locked by another worker instance
        } catch (err) {
          continue;
        }

        try {
          const user = await prisma.user.findFirst({ where: { chatId: order.chatId } });
          if (!user) {
            console.error(`[Recurring Worker] User for limit order ${order.id} not found.`);
            continue;
          }

          const secretKey = decryptForUserWithMigration(user.stellarSecret, user.id).plaintext;
          const direction = order.fromAsset === "USDC" ? "USDC_TO_XLM" : "XLM_TO_USDC";

          console.log(`[Recurring Worker] Price target met! Executing Limit Order ${order.id} (Current Price: ${currentPrice.toFixed(4)} USDC/XLM)...`);
          const txHash = await swapTokens(secretKey, order.amount, direction);

          await prisma.limitOrderJob.update({
            where: { id: order.id },
            data: { txHash }
          });

          if (notificationSender) {
            const readableDir = order.fromAsset === "USDC" ? "USDC → XLM" : "XLM → USDC";
            const alertMsg = `🎉 *Limit Order Triggered & Executed!* \n\nSuccessfully swapped *${order.amount} ${order.fromAsset} → ${order.toAsset}* because the price reached *${currentPrice.toFixed(4)} USDC/XLM* (Target: ${order.condition === "LESS_THAN_OR_EQUAL" ? "<=" : ">="} ${triggerPriceNum.toFixed(4)} USDC/XLM).\n\n🔗 Transaction: https://stellar.expert/explorer/testnet/tx/${txHash}`;
            await notificationSender(order.chatId, alertMsg);
          }
        } catch (err: any) {
          console.error(`[Recurring Worker] Limit Order execution failed:`, err.message);
          // Restore active status so it can be retried in the next check if condition remains met
          await prisma.limitOrderJob.update({
            where: { id: order.id },
            data: { isActive: true }
          });
          if (notificationSender) {
            await notificationSender(order.chatId, `⚠️ *Limit Order Trigger Failed:* ${err.message}\n\nI will retry execution during the next price poll if the condition is still satisfied.`);
          }
        }
      }
    }
  } catch (priceErr: any) {
    console.error("[Recurring Worker] Failed to fetch current price for limit order checks:", priceErr.message);
  }
}

const notifiedCliffs = new Set<string>();
const lastNotifiedLowBalance = new Map<string, number>();

async function processContractWatchers() {
  const deployDir = path.join(process.cwd(), "public", "deploys");
  if (!fs.existsSync(deployDir)) return;

  try {
    const files = fs.readdirSync(deployDir).filter(f => f.startsWith("contract-") && f.endsWith(".md"));
    for (const file of files) {
      const contractId = file.replace("contract-", "").replace(".md", "");
      if (notifiedCliffs.has(contractId)) continue;

      const content = fs.readFileSync(path.join(deployDir, file), "utf-8");
      
      const typeMatch = content.match(/-\s*\*Contract Type\*\*:\s*(.+)/i);
      const type = typeMatch ? typeMatch[1].trim().toLowerCase() : "";
      
      // We only watch vesting, escrow, or timelock contracts
      if (!type.includes("vesting") && !type.includes("escrow") && !type.includes("timelock")) {
        continue;
      }

      const deployerMatch = content.match(/-\s*\*Deployer Public Key\*\*:\s*`?([A-Z0-9a-z]+)`?/i);
      const deployer = deployerMatch ? deployerMatch[1].trim() : "";
      
      const lockMatch = content.match(/(?:Cliff|Deadline|Release|Timeout|Duration|Unlock|Lock)\s*(?:Time|Date|Duration|Period)?\*\*:\s*`?([^\n`\r]+)`?/i);
      if (!lockMatch || !deployer) continue;

      const lockDetails = lockMatch[1].trim();

      let lockDate: Date | null = null;
      if (lockDetails.toLowerCase().includes("utc") || !isNaN(Date.parse(lockDetails))) {
        lockDate = new Date(lockDetails.replace(/~|\*/g, ""));
      } else {
        const relativeSecondsMatch = lockDetails.match(/(\d+)\s*seconds/i);
        if (relativeSecondsMatch) {
          const stats = fs.statSync(path.join(deployDir, file));
          lockDate = new Date(stats.birthtime.getTime() + parseInt(relativeSecondsMatch[1]) * 1000);
        }
      }

      if (lockDate && !isNaN(lockDate.getTime())) {
        if (new Date() >= lockDate) {
          const user = await prisma.user.findFirst({ where: { stellarPublic: deployer } });
          if (user && notificationSender) {
            notifiedCliffs.add(contractId);
            const msg = `🔔 *Contract Cliff Watcher Alert!*\n\nThe lock period/cliff on your *${type.toUpperCase()}* contract has successfully passed!\n\n• *Contract:* ${contractId}\n• *Cliff time:* ${lockDetails}\n\nYou or the beneficiary are now eligible to claim or release locked tokens on-chain.`;
            await notificationSender(user.chatId, msg);
            console.log(`[Recurring Worker] Cliff passed for contract ${contractId}. Notified user ${user.chatId}`);
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[Recurring Worker] Error in contract watchers:", err.message);
  }
}

async function processLowBalances() {
  try {
    const users = await prisma.user.findMany();
    for (const user of users) {
      // Limit alert frequency to once every 24 hours
      const lastAlert = lastNotifiedLowBalance.get(user.stellarPublic) || 0;
      if (Date.now() - lastAlert < 24 * 60 * 60 * 1000) {
        continue;
      }

      const balances = await getBalances(user.stellarPublic);
      const xlmBalance = parseFloat(balances.xlm || "0");

      if (xlmBalance < 2.0) {
        lastNotifiedLowBalance.set(user.stellarPublic, Date.now());
        if (notificationSender) {
          const alertMsg = `⚠️ *Low Wallet Balance Alert!*\n\nYour active Stellar wallet (*${user.stellarPublic.substring(0, 8)}...*) has only *${xlmBalance.toFixed(2)} XLM* remaining.\n\n*Why this matters:* Stellar accounts require a minimum reserve of 1.0 - 1.5 XLM to maintain trustlines (e.g. for USDC) and process actions. Please deposit a small amount of XLM to prevent transaction failures.`;
          await notificationSender(user.chatId, alertMsg);
          console.log(`[Recurring Worker] Notified user ${user.chatId} of low balance: ${xlmBalance} XLM`);
        }
      }
    }
  } catch (err: any) {
    console.error("[Recurring Worker] Error in low balance checks:", err.message);
  }
}

async function processCustomAlertJobs() {
  const activeAlerts = await prisma.alertJob.findMany({
    where: { isActive: true }
  });

  if (activeAlerts.length === 0) return;

  for (const alert of activeAlerts) {
    try {
      let isTriggered = false;

      switch (alert.alertType.toUpperCase()) {
        case "REMINDER": {
          let triggerDate = new Date(alert.triggerCondition);
          if (isNaN(triggerDate.getTime())) {
            const relativeSec = parseInt(alert.triggerCondition);
            if (!isNaN(relativeSec)) {
              triggerDate = new Date(alert.createdAt.getTime() + relativeSec * 1000);
            }
          }
          
          if (!isNaN(triggerDate.getTime()) && new Date() >= triggerDate) {
            isTriggered = true;
          }
          break;
        }

        case "BALANCE": {
          const match = alert.triggerCondition.match(/([a-zA-Z0-9]+)\s*(<|>|<=|>=|==)\s*([0-9.]+)/);
          if (match) {
            const [, asset, operator, thresholdStr] = match;
            const threshold = parseFloat(thresholdStr);
            const user = await prisma.user.findFirst({ where: { chatId: alert.chatId } });
            if (user) {
              const balances = await getBalances(user.stellarPublic);
              const assetBalance = parseFloat((asset.toUpperCase() === "USDC" ? balances.usdc : balances.xlm) || "0");
              
              if (operator === "<" && assetBalance < threshold) isTriggered = true;
              else if (operator === ">" && assetBalance > threshold) isTriggered = true;
              else if (operator === "<=" && assetBalance <= threshold) isTriggered = true;
              else if (operator === ">=" && assetBalance >= threshold) isTriggered = true;
              else if (operator === "==" && assetBalance === threshold) isTriggered = true;
            }
          }
          break;
        }

        case "PRICE": {
          const match = alert.triggerCondition.match(/([a-zA-Z0-9]+)\s*(<|>|<=|>=|==)\s*([0-9.]+)/);
          if (match) {
            const [, assetSymbol, operator, thresholdStr] = match;
            const threshold = parseFloat(thresholdStr);
            let currentPrice: number;
            try {
              const result = await getSinglePrice(assetSymbol.toUpperCase());
              currentPrice = result.priceUsd;
            } catch {
              // fallback to Horizon for XLM
              currentPrice = await getCurrentPriceOfXlmInUsdc();
            }
            
            if (operator === "<"  && currentPrice <  threshold) isTriggered = true;
            else if (operator === ">"  && currentPrice >  threshold) isTriggered = true;
            else if (operator === "<=" && currentPrice <= threshold) isTriggered = true;
            else if (operator === ">=" && currentPrice >= threshold) isTriggered = true;
            else if (operator === "==" && currentPrice === threshold) isTriggered = true;
          }
          break;
        }

        case "TRANSACTION": {
          const user = await prisma.user.findFirst({ where: { chatId: alert.chatId } });
          if (user) {
            const url = `${process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org"}/accounts/${user.stellarPublic}/payments?limit=5&order=desc`;
            const resp = await fetch(url);
            if (resp.ok) {
              const data = await resp.json();
              const payments = data._embedded?.records || [];
              for (const p of payments) {
                const payDate = new Date(p.created_at);
                if (payDate > alert.createdAt && p.type === "payment" && p.to === user.stellarPublic) {
                  if (p.from === alert.triggerCondition || p.from.includes(alert.triggerCondition)) {
                    isTriggered = true;
                    break;
                  }
                }
              }
            }
          }
          break;
        }
      }

      if (isTriggered) {
        const updateResult = await prisma.alertJob.updateMany({
          where: { id: alert.id, isActive: true },
          data: { isActive: false }
        });
        
        if (updateResult.count > 0 && notificationSender) {
          await notificationSender(alert.chatId, `🔔 *Alert Triggered!*\n\n${alert.message}`);
          console.log(`[Recurring Worker] Custom alert ${alert.id} triggered and sent to ${alert.chatId}`);
        }
      }
    } catch (err: any) {
      console.error(`[Recurring Worker] Custom Alert ${alert.id} check failed:`, err.message);
    }
  }
}

