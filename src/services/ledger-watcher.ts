import { Horizon } from "@stellar/stellar-sdk";
import { prisma } from "./db";
import { config } from "./config";
import { getBalances } from "./stellar";

let botSendMessage: ((chatId: string, text: string) => Promise<string>) | null = null;
let activeCloseStream: (() => void) | null = null;
let reconnectTimeout: any = null;
let reconnectAttempts = 0;

export function setLedgerWatcherNotificationSender(sender: (chatId: string, text: string) => Promise<string>) {
  botSendMessage = sender;
}

export function startLedgerWatcher() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (activeCloseStream) {
    try {
      activeCloseStream();
    } catch {}
    activeCloseStream = null;
  }

  console.log("=========================================");
  console.log(`[Ledger Watcher] Real-time payment stream starting (Attempt ${reconnectAttempts + 1})...`);
  console.log("=========================================");

  const horizonServer = new Horizon.Server(config.stellarHorizonUrl);

  // Start streaming payments from "now"
  const closeStream = horizonServer.payments()
    .cursor("now")
    .stream({
      onmessage: async (payment: any) => {
        try {
          if (payment.type !== "payment") return;
          reconnectAttempts = 0; // Reset attempts on successful message
          const toAddress = payment.to;
          const fromAddress = payment.from;
          const amount = payment.amount;
          const assetCode = payment.asset_code || "XLM";

          // Lookup if the recipient is a registered bot user
          const recipientUser = await prisma.user.findFirst({
            where: { stellarPublic: toAddress }
          });

          if (recipientUser) {
            // Avoid notifying on self-transfers (swaps, merging, etc.)
            if (fromAddress === toAddress) return;

            console.log(`[Ledger Watcher] Payment detected to registered user: ${amount} ${assetCode} to ${toAddress}`);

            // Fetch new balances for a rich notification card
            const balances = await getBalances(recipientUser.stellarPublic);

            if (botSendMessage) {
              const shortFrom = `${fromAddress.slice(0, 6)}...${fromAddress.slice(-6)}`;
              const notificationText = `📩 *Payment Received!* \n\nYou have received *${amount} ${assetCode}* from account \`${shortFrom}\`.\n\n💰 *New Balances:* \n• XLM: ${balances.xlm}\n• USDC: ${balances.usdc}\n\n🔗 View details: ${config.explorerUrlStellar}${payment.transaction_hash}`;
              
              await botSendMessage(recipientUser.chatId, notificationText);
            }
          }
        } catch (err: any) {
          console.error("[Ledger Watcher] Error processing streamed payment event:", err.message);
        }
      },
      onerror: (error: any) => {
        console.error("[Ledger Watcher] Payment stream encountered an error:", error.message || error);
        
        // Close stream
        if (activeCloseStream) {
          try { activeCloseStream(); } catch {}
          activeCloseStream = null;
        }

        // Reconnect with exponential backoff
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`[Ledger Watcher] Reconnecting in ${delay / 1000}s...`);
        reconnectTimeout = setTimeout(() => {
          startLedgerWatcher();
        }, delay);
      }
    });

  activeCloseStream = closeStream;
  return () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (activeCloseStream) {
      try { activeCloseStream(); } catch {}
      activeCloseStream = null;
    }
  };
}
