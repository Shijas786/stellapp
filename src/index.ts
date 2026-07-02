import dotenv from "dotenv";
import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import { WhatsAppBot } from "./bot/whatsapp";
import { setNotificationSender } from "./agent/tools";
import { prisma } from "./services/db";

// Load Environment Variables
dotenv.config();

console.log("=========================================");
console.log("Starting Stellar WhatsApp AI Bot...");
console.log("=========================================");

async function clearDatabase() {
  try {
    console.log("⚠️ [DB Reset] CLEARING DATABASE FOR A FRESH START...");
    await prisma.privacyDeposit.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.sessionState.deleteMany();
    await prisma.user.deleteMany();
    await prisma.confidentialRegistry.deleteMany();
    console.log("✅ [DB Reset] DATABASE SUCCESSFULLY CLEARED!");
  } catch (err) {
    console.error("[DB Reset] Failed to clear database:", err);
  }
}
clearDatabase();

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
  
  // 1. Stellar Federation TOML Endpoint
  if (parsedUrl.pathname === "/.well-known/stellar.toml") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`FEDERATION_SERVER="https://${_req.headers.host}/api/federation"\n`);
    return;
  }

  // 2. Stellar Federation API Endpoint
  if (parsedUrl.pathname === "/api/federation") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    
    if (query.type === "name" && typeof query.q === "string") {
      const parts = query.q.split("*");
      if (parts.length === 2) {
        const username = parts[0].toLowerCase();
        try {
          const user = await prisma.user.findFirst({ where: { username } });
          if (user && user.stellarPublic) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              stellar_address: user.stellarPublic,
              account_id: user.stellarPublic,
              memo_type: "text",
              memo: "Stellapp"
            }));
            return;
          }
        } catch (e) {
          console.error("Federation DB Error:", e);
        }
      }
    }
    
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Account not found." }));
    return;
  }

  // 2.5 Auth API Endpoints (Dashboard Login)
  // Restrict CORS to known dashboard origin only (P3 fix)
  const ALLOWED_ORIGIN = process.env.DASHBOARD_URL || "http://localhost:3000";

  if (_req.method === "POST" && parsedUrl.pathname === "/api/auth/request-otp") {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
    let body = "";
    _req.on("data", chunk => body += chunk.toString());
    _req.on("end", async () => {
      try {
        const { phoneNumber } = JSON.parse(body);
        const { generateOTP } = require("./services/auth");
        const code = generateOTP(phoneNumber);
        
        // Send OTP via WhatsApp
        const waId = `${phoneNumber.replace(/\D/g, "")}@c.us`;
        await bot.sendMessage(waId, `🔐 Your Stellapp dashboard login code is: *${code}*.\n\nThis code will expire in 5 minutes.`);
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "OTP sent" }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (_req.method === "POST" && parsedUrl.pathname === "/api/auth/verify-otp") {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
    let body = "";
    _req.on("data", chunk => body += chunk.toString());
    _req.on("end", async () => {
      try {
        const { phoneNumber, code } = JSON.parse(body);
        const { validateOTP, issueToken } = require("./services/auth");
        
        if (validateOTP(phoneNumber, code)) {
          const token = issueToken(phoneNumber);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, token }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: "Invalid or expired OTP" }));
        }
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Handle CORS Preflight for the API
  if (_req.method === "OPTIONS" && parsedUrl.pathname?.startsWith("/api/auth")) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Vary", "Origin");
    res.writeHead(204);
    res.end();
    return;
  }

  // Admin-only route to fix existing orphaned accounts (requires secret token)
  if (_req.method === "GET" && parsedUrl.pathname === "/api/auth/fix-accounts") {
    // Require the ENCRYPTION_KEY as a query param for security
    if (query.secret !== token) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    try {
      const allUsers = await prisma.user.findMany();
      // Find short orphans (assumed to be the ones without country code)
      const orphans = allUsers.filter(u => u.chatId.length <= 15 && u.chatId.endsWith("@c.us"));
      let fixed = 0;
      let logs = [];
      
      for (const orphan of orphans) {
        const rawNumber = orphan.chatId.replace("@c.us", "");
        
        // Find any other account that ends with this raw number and is longer (has country code)
        const realAccount = allUsers.find(u => 
          u.chatId !== orphan.chatId && 
          u.chatId.endsWith(`${rawNumber}@c.us`) &&
          u.chatId.length > orphan.chatId.length
        );
        
        if (realAccount) {
          logs.push(`Found duplicate! Orphan: ${orphan.chatId}, Real: ${realAccount.chatId}`);
          
          // Delete the empty duplicate account first
          await prisma.user.delete({
            where: { id: realAccount.id }
          });
          
          // Rename the orphan to the correct long chatId
          await prisma.user.update({
            where: { id: orphan.id },
            data: {
              chatId: realAccount.chatId
            }
          });
          
          fixed++;
          logs.push(`Fixed account for ${realAccount.chatId}!`);
        }
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, fixed, logs }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 3. Serve Public Landing Page
  if ((parsedUrl.pathname === "/" || parsedUrl.pathname === "/roadmap.html") && !query.token) {
    const fileName = parsedUrl.pathname === "/" ? "index.html" : "roadmap.html";
    const indexPath = path.join(process.cwd(), "public", fileName);
    if (fs.existsSync(indexPath)) {
      let html = fs.readFileSync(indexPath, "utf-8");
      html = html.replace(/http:\/\/localhost:3000/g, ALLOWED_ORIGIN);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
  }

  // 3.5 Serve Next.js Dashboard
  if (parsedUrl.pathname?.startsWith("/dashboard")) {
    let targetPath = parsedUrl.pathname.replace(/^\/dashboard/, "");
    if (targetPath === "" || targetPath === "/") {
      targetPath = "/index.html";
    } else if (!path.extname(targetPath)) {
      targetPath += ".html";
    }
    
    const dashboardPath = path.join(process.cwd(), "dashboard", "out", targetPath);
    console.log(`[Dashboard Route] Request: ${parsedUrl.pathname} -> looking for: ${dashboardPath}`);
    if (fs.existsSync(dashboardPath)) {
      const ext = path.extname(dashboardPath);
      let contentType = "text/html; charset=utf-8";
      if (ext === ".css") contentType = "text/css";
      else if (ext === ".js") contentType = "application/javascript";
      else if (ext === ".png") contentType = "image/png";
      else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".svg") contentType = "image/svg+xml";
      else if (ext === ".json") contentType = "application/json";
      else if (ext === ".txt") contentType = "text/plain";
      
      res.writeHead(200, { "Content-Type": contentType });
      res.end(fs.readFileSync(dashboardPath));
    } else {
      let debugInfo = `Dashboard Not Found. path=${dashboardPath}. cwd=${process.cwd()}`;
      try {
        const outPath = path.join(process.cwd(), "dashboard", "out");
        if (fs.existsSync(outPath)) {
          debugInfo += `<br>Files in out folder: ` + fs.readdirSync(outPath).join(", ");
        } else {
          debugInfo += `<br>The dashboard/out folder DOES NOT EXIST!`;
        }
      } catch (err) {
        debugInfo += `<br>Error checking folder: ${(err as Error).message}`;
      }
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h2>Dashboard Not Found</h2><p>${debugInfo}</p><p>Please run <code>npm run build</code> to build the Next.js dashboard first.</p>`);
    }
    return;
  }

  // 4. Serve Public Assets (CSS, JS, Images)
  if (parsedUrl.pathname?.startsWith("/assets/")) {
    const assetPath = path.join(process.cwd(), "public", parsedUrl.pathname.replace("/assets/", ""));
    if (fs.existsSync(assetPath)) {
      const ext = path.extname(assetPath);
      let contentType = "text/plain";
      if (ext === ".css") contentType = "text/css";
      else if (ext === ".js") contentType = "application/javascript";
      else if (ext === ".png") contentType = "image/png";
      else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".svg") contentType = "image/svg+xml";
      
      res.writeHead(200, { "Content-Type": contentType });
      res.end(fs.readFileSync(assetPath));
      return;
    }
  }

  // Require token verification to access the dashboard/setup page
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

  // Handle manual session reset & cache purge
  if (query.action === "reset") {
    try {
      console.log("[Setup] Admin requested session reset. Purging local session data...");
      const authDir = path.join(process.cwd(), ".wwebjs_auth");
      const cacheDir = path.join(process.cwd(), ".wwebjs_cache");
      
      fs.rmSync(authDir, { recursive: true, force: true });
      fs.rmSync(cacheDir, { recursive: true, force: true });
      
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>♻️ Session purged successfully!</h2><p>The container will now restart and generate a clean QR code. Please wait 30 seconds and refresh the setup page.</p>");
      
      // Terminate the process with a non-zero code to force Railway to restart the container
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      return;
    } catch (err: any) {
      res.writeHead(500);
      res.end(`Failed to reset session: ${err.message}`);
      return;
    }
  }

  // Check if WhatsApp is already authenticated and active
  const qr = (global as any).__latestQR as string | undefined;
  if (!qr) {
    let totalUsers = 0;
    let onboardedUsers = 0;
    let recentUsersList: Array<{ chatId: string; username: string | null; createdAt: Date }> = [];
    
    try {
      totalUsers = await prisma.user.count();
      onboardedUsers = await prisma.user.count({ where: { onboarded: true } });
      recentUsersList = await prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: { chatId: true, username: true, createdAt: true }
      });
    } catch (dbErr) {
      console.error("Failed to query DB stats for dashboard:", dbErr);
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <html>
        <head>
          <title>📊 Stellapp Admin Dashboard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              background: #0f172a; 
              color: #f8fafc; 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
              margin: 0; 
              padding: 40px 20px; 
              display: flex; 
              justify-content: center; 
            }
            .container { max-width: 900px; width: 100%; }
            header { 
              display: flex; 
              justify-content: space-between; 
              align-items: center; 
              margin-bottom: 40px; 
              border-bottom: 1px solid #334155; 
              padding-bottom: 20px; 
            }
            h1 { margin: 0; color: #38bdf8; font-size: 28px; }
            .status-badge { 
              background: rgba(16, 185, 129, 0.1); 
              color: #10b981; 
              border: 1px solid rgba(16, 185, 129, 0.2); 
              padding: 6px 16px; 
              border-radius: 9999px; 
              font-size: 14px; 
              font-weight: 600; 
              display: flex; 
              align-items: center; 
              gap: 8px; 
            }
            .status-dot { 
              width: 8px; 
              height: 8px; 
              background: #10b981; 
              border-radius: 50%; 
              box-shadow: 0 0 8px #10b981; 
            }
            .grid { 
              display: grid; 
              grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); 
              gap: 25px; 
              margin-bottom: 40px; 
            }
            .card { 
              background: #1e293b; 
              border-radius: 16px; 
              padding: 24px; 
              border: 1px solid #334155; 
              box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); 
            }
            .card h3 { margin: 0 0 10px 0; color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
            .card .value { font-size: 32px; font-weight: bold; color: #f8fafc; }
            .card .sub { color: #64748b; font-size: 12px; margin-top: 5px; }
            
            .section-title { font-size: 18px; color: #e2e8f0; margin: 0 0 20px 0; border-bottom: 2px solid #334155; padding-bottom: 8px; }
            .details-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .details-table td { padding: 12px 16px; border-bottom: 1px solid #1e293b; font-size: 14px; }
            .details-table tr:last-child td { border-bottom: none; }
            .details-table td.label { color: #94a3b8; width: 40%; font-weight: 500; }
            .details-table td.val { font-family: monospace; color: #38bdf8; word-break: break-all; }
            
            .users-list { display: flex; flex-direction: column; gap: 12px; }
            .user-item { 
              display: flex; 
              justify-content: space-between; 
              align-items: center; 
              background: #0f172a; 
              padding: 12px 16px; 
              border-radius: 8px; 
              border: 1px solid #334155; 
            }
            .user-phone { font-family: monospace; font-size: 14px; }
            .user-username { background: #1e293b; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #34d399; }
            .user-date { font-size: 12px; color: #64748b; }
            
            .btn-reset { 
              background: rgba(244, 63, 94, 0.1); 
              color: #f43f5e; 
              border: 1px solid rgba(244, 63, 94, 0.2); 
              padding: 10px 20px; 
              border-radius: 8px; 
              font-weight: 600; 
              cursor: pointer; 
              text-decoration: none; 
              display: inline-block; 
              transition: all 0.2s; 
            }
            .btn-reset:hover { 
              background: #f43f5e; 
              color: #fff; 
            }
            .no-users { text-align: center; color: #64748b; font-size: 14px; padding: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <header>
              <div>
                <h1>Stellapp Dashboard</h1>
                <p style="color: #64748b; margin: 5px 0 0 0; font-size: 14px;">Stellar WhatsApp AI Bot Administration</p>
              </div>
              <div class="status-badge">
                <span class="status-dot"></span> Active & Online
              </div>
            </header>
            
            <div class="grid">
              <div class="card">
                <h3>Total Registered Users</h3>
                <div class="value">${totalUsers}</div>
                <div class="sub">WhatsApp wallets generated</div>
              </div>
              <div class="card">
                <h3>Onboarded Users</h3>
                <div class="value">${onboardedUsers}</div>
                <div class="sub">Completed profile username setup</div>
              </div>
              <div class="card">
                <h3>Stellar Network</h3>
                <div class="value" style="color: #38bdf8; font-size: 24px; padding: 5px 0;">${process.env.STELLAR_NETWORK || 'TESTNET'}</div>
                <div class="sub">${process.env.STELLAR_RPC_URL ? 'Soroban RPC Connected' : 'Horizon Mode Only'}</div>
              </div>
            </div>
            
            <div class="grid" style="grid-template-columns: 1fr 1fr;">
              <!-- System Variables -->
              <div class="card">
                <h3 class="section-title">System Configurations</h3>
                <table class="details-table">
                  <tr>
                    <td class="label">Stellar Horizon Node</td>
                    <td class="val">${process.env.STELLAR_HORIZON_URL || 'Horizon offline'}</td>
                  </tr>
                  <tr>
                    <td class="label">Base Sepolia RPC</td>
                    <td class="val">${process.env.EVM_RPC_URL || 'EVM offline'}</td>
                  </tr>
                  <tr>
                    <td class="label">USDC Token Code</td>
                    <td class="val">${process.env.USDC_ASSET_CODE || 'USDC'}</td>
                  </tr>
                  <tr>
                    <td class="label">Escrow Contract WASM</td>
                    <td class="val">${process.env.ESCROW_WASM_HASH ? process.env.ESCROW_WASM_HASH.substring(0, 16) + '...' : 'Not loaded'}</td>
                  </tr>
                </table>
                
                <h3 class="section-title">Control Actions</h3>
                <div style="margin-top: 10px;">
                  <a href="?token=${token}&action=reset" class="btn-reset" onclick="return confirm('Are you sure you want to log out and clear the active WhatsApp session cache? You will need to scan a new QR code to reconnect.')">♻️ Disconnect Bot & Reset Session</a>
                </div>
              </div>
              
              <!-- Recent Onboards -->
              <div class="card">
                <h3 class="section-title">Recent Registrations</h3>
                <div class="users-list">
                  ${recentUsersList.length === 0 ? `
                    <div class="no-users">No users onboarded yet. Share your bot link to start!</div>
                  ` : recentUsersList.map(u => {
                    const cleanPhone = u.chatId.split("@")[0];
                    const maskedPhone = cleanPhone.substring(0, 4) + '****' + cleanPhone.substring(cleanPhone.length - 4);
                    return `
                      <div class="user-item">
                        <div>
                          <span class="user-phone">+${maskedPhone}</span>
                          ${u.username ? `<span class="user-username">@${u.username}</span>` : ''}
                        </div>
                        <span class="user-date">${new Date(u.createdAt).toLocaleDateString()}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>
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
            <div style="text-align:center; margin-top:30px;">
              <a href="?token=${token}&action=reset" style="color:#64748b; font-size:13px; text-decoration:none; border: 1px dashed #475569; padding: 6px 12px; border-radius: 6px; display: inline-block; transition: color 0.2s;" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#64748b'">♻️ Stale QR or Sync Hung? Reset and Generate Fresh QR</a>
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
