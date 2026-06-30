import dotenv from "dotenv";
import http from "http";
import QRCode from "qrcode";
import { WhatsAppBot } from "./bot/whatsapp";
import { setNotificationSender } from "./agent/tools";

// Load Environment Variables
dotenv.config();

console.log("=========================================");
console.log("Starting Stellar WhatsApp AI Bot...");
console.log("=========================================");

// 1. Initialize WhatsApp Adapter
const bot = new WhatsAppBot();

// 2. Configure Async Notification Sender
// This allows background workers (e.g. CCTP bridging) to send updates to the chat
setNotificationSender(async (chatId, text) => {
  try {
    await bot.sendMessage(chatId, text);
    console.log(`[Notification] Asynchronous alert sent to ${chatId}`);
  } catch (error: any) {
    console.error(`[Notification] Failed to send notification to ${chatId}:`, error.message);
  }
});

// 3. Start HTTP server for QR code scanning (required for Railway / headless deployments)
// Visit your Railway URL to see the QR code and link your WhatsApp account.
const PORT = process.env.PORT || 3000;
http.createServer(async (_req, res) => {
  const qr = (global as any).__latestQR as string | undefined;
  if (!qr) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html><body style="text-align:center;font-family:sans-serif;padding:40px">
        <h2>✅ WhatsApp Bot Connected!</h2>
        <p>The bot is authenticated and processing messages.</p>
        <p style="color:gray">No QR code needed — session is active.</p>
      </body></html>
    `);
    return;
  }
  try {
    const qrImageUrl = await QRCode.toDataURL(qr);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html><body style="text-align:center;font-family:sans-serif;padding:40px">
        <h2>📱 Scan to Connect WhatsApp Bot</h2>
        <p>Open WhatsApp → Linked Devices → Link a Device → Scan this QR</p>
        <img src="${qrImageUrl}" style="width:280px;border:4px solid #25D366;border-radius:8px"/>
        <p style="color:gray;font-size:13px">QR expires after ~20 seconds. Refresh this page to get a new one.</p>
      </body></html>
    `);
  } catch (err) {
    res.writeHead(500);
    res.end("Failed to generate QR code image.");
  }
}).listen(PORT, () => {
  console.log(`[QR Server] Running at http://localhost:${PORT} — visit your Railway URL to scan the QR`);
});

// 4. Initialize WhatsApp Client Connection
bot.initialize();
