import dotenv from "dotenv";
import http from "http";
import url from "url";
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
setNotificationSender(async (chatId, text) => {
  try {
    await bot.sendMessage(chatId, text);
    console.log(`[Notification] Asynchronous alert sent to ${chatId}`);
  } catch (error: any) {
    console.error(`[Notification] Failed to send notification to ${chatId}:`, error.message);
  }
});

// 3. Start HTTP server for QR & Phone Link setup
const PORT = process.env.PORT || 3000;
http.createServer(async (_req, res) => {
  const parsedUrl = url.parse(_req.url || "", true);
  const query = parsedUrl.query;
  const token = process.env.ENCRYPTION_KEY || "";
  
  // Require token verification to access the setup page
  if (query.token !== token) {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <html>
        <head>
          <title>🔒 Administration Panel Locked</title>
          <style>
            body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); text-align: center; max-width: 420px; border: 1px solid #334155; }
            h2 { color: #f43f5e; margin-top: 0; }
            p { color: #94a3b8; font-size: 15px; line-height: 1.6; }
            code { display: block; background: #0f172a; padding: 12px; border-radius: 8px; font-size: 14px; color: #38bdf8; margin-top: 20px; font-family: monospace; border: 1px solid #1e293b; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🔒 Access Denied</h2>
            <p>To link this bot, please include your secure ENCRYPTION_KEY as a token parameter in the URL:</p>
            <code>?token=YOUR_ENCRYPTION_KEY</code>
          </div>
        </body>
      </html>
    `);
    return;
  }

  // Check if WhatsApp is already authenticated and active
  const qr = (global as any).__latestQR as string | undefined;
  if (!qr) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <html>
        <head>
          <title>✅ Bot Connected</title>
          <style>
            body { background: #0f172a; color: #f8fafc; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; }
            h2 { color: #10b981; margin-top: 0; }
            p { color: #94a3b8; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>✅ WhatsApp Bot Connected!</h2>
            <p>The bot is authenticated and actively processing messages.</p>
            <p style="color:#64748b; font-size: 14px;">No configuration or QR pairing needed.</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  // Handle phone pairing code request
  let pairingCode: string | null = null;
  let pairingError: string | null = null;
  const targetPhone = query.phone as string | undefined;

  if (targetPhone) {
    try {
      // Strip any non-digits
      const cleanPhone = targetPhone.replace(/\D/g, "");
      if (cleanPhone.length < 8) {
        throw new Error("Invalid phone number length. Use international format (e.g. 12025550100).");
      }
      pairingCode = await bot.getPairingCode(cleanPhone);
      console.log(`[WhatsApp] Successfully generated pairing code for ${cleanPhone}: ${pairingCode}`);
    } catch (err: any) {
      pairingError = err.message || "Failed to generate pairing code.";
      console.error("[WhatsApp] Pairing code generation error:", err);
    }
  }

  try {
    const qrImageUrl = await QRCode.toDataURL(qr);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <html>
        <head>
          <title>📱 Connect WhatsApp Bot</title>
          <style>
            body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
            .container { max-width: 800px; width: 100%; }
            header { text-align: center; margin-bottom: 40px; }
            h1 { margin: 0 0 10px 0; color: #38bdf8; }
            p.subtitle { color: #94a3b8; margin: 0; font-size: 16px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
            @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
            .card { background: #1e293b; border-radius: 16px; padding: 30px; border: 1px solid #334155; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
            h2 { font-size: 20px; margin-top: 0; color: #e2e8f0; border-bottom: 2px solid #334155; padding-bottom: 10px; width: 100%; text-align: center; }
            .instructions { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; width: 100%; }
            .instructions ol { padding-left: 20px; margin: 10px 0; }
            input[type="text"] { width: 100%; background: #0f172a; border: 1px solid #475569; padding: 12px; border-radius: 8px; color: #fff; font-size: 16px; box-sizing: border-box; margin-bottom: 15px; }
            input[type="text"]:focus { outline: none; border-color: #38bdf8; }
            button { width: 100%; background: #25d366; color: #fff; border: none; padding: 14px; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; transition: background 0.2s; }
            button:hover { background: #128c7e; }
            .code-display { background: #0f172a; color: #34d399; font-size: 32px; font-weight: bold; font-family: monospace; letter-spacing: 4px; padding: 15px 30px; border-radius: 8px; border: 2px dashed #059669; margin: 20px 0; text-align: center; text-transform: uppercase; width: 80%; }
            .error { color: #f87171; background: rgba(248, 113, 113, 0.1); padding: 10px; border-radius: 6px; border: 1px solid rgba(248, 113, 113, 0.2); width: 100%; text-align: center; font-size: 14px; margin-bottom: 15px; }
          </style>
        </head>
        <body>
          <div class="container">
            <header>
              <h1>📱 Connect Stellapp Bot</h1>
              <p class="subtitle">Choose either QR scan or Phone Pairing to link the WhatsApp bot client.</p>
            </header>
            
            <div class="grid">
              <!-- QR Section -->
              <div class="card">
                <h2>Scan QR Code</h2>
                <div class="instructions">
                  <ol>
                    <li>Open <b>WhatsApp</b> on your phone.</li>
                    <li>Tap <b>Menu</b> or <b>Settings</b> → <b>Linked Devices</b>.</li>
                    <li>Tap <b>Link a Device</b>.</li>
                    <li>Point your camera at this QR code.</li>
                  </ol>
                </div>
                <img src="${qrImageUrl}" style="width:220px; border:4px solid #25D366; border-radius:8px; margin:10px 0; background:white; padding:10px;" />
              </div>
              
              <!-- Phone Code Section -->
              <div class="card">
                <h2>Link with Phone Number</h2>
                <div class="instructions">
                  <ol>
                    <li>Open <b>WhatsApp</b> on your phone.</li>
                    <li>Go to <b>Linked Devices</b> → tap <b>Link a Device</b>.</li>
                    <li>Tap <b>Link with phone number instead</b>.</li>
                    <li>Generate a code below and enter it on your phone.</li>
                  </ol>
                </div>
                
                ${pairingError ? `<div class="error">❌ ${pairingError}</div>` : ""}
                
                ${pairingCode ? `
                  <div style="text-align:center; width:100%; display:flex; flex-direction:column; align-items:center;">
                    <p style="color:#34d399; font-size:14px; margin:0;">Enter this code on your phone:</p>
                    <div class="code-display">${pairingCode}</div>
                    <p style="color:#64748b; font-size:12px; margin:0;">Code expires in 3 minutes.</p>
                    <button style="margin-top:15px; background:#475569;" onclick="window.location.search = '?token=${token}'">Reset / Go Back</button>
                  </div>
                ` : `
                  <form method="GET" style="width: 100%;">
                    <input type="hidden" name="token" value="${token}" />
                    <label style="display:block; font-size:13px; color:#94a3b8; margin-bottom:5px;">Phone Number (International Format)</label>
                    <input type="text" name="phone" placeholder="e.g. 919876543210" required />
                    <button type="submit">Generate Pairing Code</button>
                  </form>
                `}
              </div>
            </div>
          </div>

          <script>
            // Automatically refresh the page every 15 seconds to fetch a fresh QR code,
            // but do not refresh if the user has requested and is viewing a phone pairing code.
            setTimeout(() => {
              const hasCode = !!document.querySelector('.code-display');
              const hasError = !!document.querySelector('.error');
              if (!hasCode && !hasError) {
                console.log("[Setup] Refreshing to keep QR code fresh...");
                window.location.reload();
              }
            }, 15000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    res.writeHead(500);
    res.end("Failed to generate setup interface.");
  }
}).listen(PORT, () => {
  console.log(`[QR/Phone Server] Running at http://localhost:${PORT}`);
});

// 4. Initialize WhatsApp Client Connection
bot.initialize();
