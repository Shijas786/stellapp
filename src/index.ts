import dotenv from "dotenv";
import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import QRCode from "qrcode";
import { WhatsAppBot } from "./bot/whatsapp";
import { setNotificationSender, setDocumentSender, setNotificationEditor } from "./agent/tools";
import { prisma } from "./services/db";
import { getBalances } from "./services/stellar";
import { config } from "./services/config";
import { networkStorage } from "./services/network-context";


// Load Environment Variables
dotenv.config();


console.log("=========================================");
console.log("Starting Stellar WhatsApp AI Bot...");
console.log("=========================================");

async function logConfidentialRegistries() {
  try {
    const registries = await prisma.confidentialRegistry.findMany();
    console.log("=========================================");
    console.log("[ZK Diagnostic] Active Confidential registries in DB:");
    console.log(JSON.stringify(registries, null, 2));
    console.log("=========================================");
  } catch (err) {
    console.error("[ZK Diagnostic] Failed to log registries:", err);
  }
}
logConfidentialRegistries();

import { startRecurringWorker, setRecurringNotificationSender } from "./services/recurring-worker";
import { startLedgerWatcher, setLedgerWatcherNotificationSender } from "./services/ledger-watcher";

// 1. Initialize WhatsApp Adapter
const bot = new WhatsAppBot();

// 2. Configure Async Notification Sender
const asyncNotificationSender = async (chatId: string, text: string): Promise<string> => {
  try {
    const msgId = await bot.sendMessage(chatId, text);
    console.log(`[Notification] Asynchronous alert sent to ${chatId}`);
    return msgId;
  } catch (error: any) {
    console.error(`[Notification] Failed to send notification to ${chatId}:`, error.message);
    return "";
  }
};
setNotificationSender(asyncNotificationSender);
setNotificationEditor(async (chatId, msgId, text) => {
  await bot.editMessage(chatId, msgId, text);
});
setDocumentSender(async (chatId, filePath, caption) => {
  await bot.sendDocumentMessage(chatId, filePath, caption);
});
setRecurringNotificationSender(
  asyncNotificationSender,
  async (chatId, msgId, text) => { await bot.editMessage(chatId, msgId, text); },
  async (chatId) => { await bot.sendTypingState(chatId); }
);
setLedgerWatcherNotificationSender(asyncNotificationSender);

// Start background recurring jobs worker
startRecurringWorker();

// Start real-time on-chain payment stream listener
startLedgerWatcher();



// 3. Start HTTP server for QR & Phone Link setup
const PORT = process.env.PORT || 3000;
http.createServer(async (_req, res) => {
  const parsedUrl = url.parse(_req.url || "", true);
  const query = parsedUrl.query;
  // ADMIN_API_SECRET is a dedicated secret for admin routes — completely separate
  // from ENCRYPTION_KEY (the wallet-decryption master key).
  const ADMIN_SECRET = process.env.ADMIN_API_SECRET || "";
  
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

  // 2.5 Health Check Endpoint
  if (parsedUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }






  // Admin-only route to fix existing orphaned accounts (requires secret token)
  if (_req.method === "GET" && parsedUrl.pathname === "/api/auth/fix-accounts") {
    // Require ADMIN_API_SECRET — read from Authorization header (preferred) or
    // query param (legacy, kept for backward-compat but logs a deprecation warning).
    if (!ADMIN_SECRET) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ADMIN_API_SECRET not configured on server" }));
      return;
    }

    let providedSecret: string | undefined;
    const authHeader = _req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      providedSecret = authHeader.slice(7);
    } else if (typeof query.secret === "string") {
      console.warn("[Admin] Secret provided via query param — prefer Authorization: Bearer <secret> to avoid log exposure");
      providedSecret = query.secret;
    }

    // Constant-time comparison to prevent timing oracle attacks
    const secretsMatch =
      providedSecret !== undefined &&
      providedSecret.length === ADMIN_SECRET.length &&
      crypto.timingSafeEqual(
        Buffer.from(providedSecret, "utf8"),
        Buffer.from(ADMIN_SECRET, "utf8")
      );

    if (!secretsMatch) {
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

  // 2.9 Serve dynamic contract deployment Markdown files
  if (parsedUrl.pathname?.startsWith("/deploys/")) {
    const filename = path.basename(parsedUrl.pathname);
    const filepath = path.join(process.cwd(), "public", "deploys", filename);
    if (fs.existsSync(filepath)) {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      res.end(fs.readFileSync(filepath));
      return;
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Deployment document not found.");
      return;
    }
  }

  // Require token verification to access the dashboard/setup page
  if (query.token !== ADMIN_SECRET) {
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
            <p>To link this bot, please include your secure ADMIN_API_SECRET as a token parameter in the URL:</p>
            <code>?token=YOUR_ADMIN_API_SECRET</code>
          </div>
        </body>
      </html>
    `);
    return;
  }

  // Handle manual database purge for fresh start (users, contacts, wallets, sessions, chats)
  if (query.action === "clear-db") {
    try {
      console.log("[Setup] Admin requested database purge. Clearing user data...");
      const deletedUsers = await prisma.user.deleteMany({});
      const deletedSessions = await prisma.sessionState.deleteMany({});
      const deletedChats = await prisma.chatHistory.deleteMany({});
      
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <head>
            <title>♻️ Database Cleared</title>
            <style>
              body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); text-align: center; max-width: 450px; border: 1px solid #334155; }
              h2 { color: #10b981; margin-top: 0; }
              p { color: #94a3b8; font-size: 15px; line-height: 1.6; }
              .stats { background: #0f172a; padding: 15px; border-radius: 8px; font-size: 14px; text-align: left; margin: 20px 0; border: 1px solid #334155; }
              .btn { display: inline-block; background: #38bdf8; color: #0f172a; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; margin-top: 10px; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>♻️ Database Cleared Successfully</h2>
              <p>All user profiles, generated wallets, contacts, active sessions, and AI chat histories have been deleted.</p>
              <div class="stats">
                • Deleted Users (Wallets/Contacts): <b>${deletedUsers.count}</b><br/>
                • Deleted Session States: <b>${deletedSessions.count}</b><br/>
                • Deleted Chat Histories: <b>${deletedChats.count}</b>
              </div>
              <a href="?token=${ADMIN_SECRET}" class="btn">Back to Dashboard</a>
            </div>
          </body>
        </html>
      `);
      return;
    } catch (err: any) {
      res.writeHead(500);
      res.end(`Failed to clear database: ${err.message}`);
      return;
    }
  }

  // Handle manual session reset to clear browser session lock issues
  if (query.action === "reset") {
    try {
      console.log("[Setup] Admin requested session reset. Purging local session data...");
        const authDir = path.join(process.cwd(), ".wwebjs_auth");
        const cacheDir = path.join(process.cwd(), ".wwebjs_cache");
        
        fs.rmSync(authDir, { recursive: true, force: true });
        fs.rmSync(cacheDir, { recursive: true, force: true });
        
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>♻️ Session purged successfully!</h2><p>The container will now restart and generate a clean QR code. Please wait 30 seconds and refresh the setup page.</p>");
        
        setTimeout(() => {
          process.exit(1);
        }, 1000);
        return;
    } catch (err: any) {
      res.writeHead(500);
      res.end(`Failed to execute action: ${err.message}`);
      return;
    }
  }

  // Check if WhatsApp is already authenticated and active
  const qr = (global as any).__latestQR as string | undefined;
  if (!qr) {
    let totalUsers = 0;
    let onboardedUsers = 0;
    let recentUsersList: Array<{ chatId: string; username: string | null; phoneNumber: string | null; stellarPublic: string; createdAt: Date }> = [];
    
    let recurringSwaps: any[] = [];
    let recurringTransfers: any[] = [];
    let limitOrders: any[] = [];
    
    let confidentialRegistries: any[] = [];
    let activeDeposits: any[] = [];
    let totalShieldedLiquidity = 0;

    const contractsList: Array<{ id: string; type: string; deployer: string; date: string; recipient: string | null; lockDetails: string | null }> = [];

    try {
      totalUsers = await prisma.user.count();
      onboardedUsers = await prisma.user.count({ where: { onboarded: true } });
      recentUsersList = await prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        select: { chatId: true, username: true, phoneNumber: true, stellarPublic: true, createdAt: true }
      });

      recurringSwaps = await prisma.recurringSwapJob.findMany({
        take: 10,
        orderBy: { createdAt: "desc" }
      });
      recurringTransfers = await prisma.recurringTransferJob.findMany({
        take: 10,
        orderBy: { createdAt: "desc" }
      });
      limitOrders = await prisma.limitOrderJob.findMany({
        take: 10,
        orderBy: { createdAt: "desc" }
      });

      confidentialRegistries = await prisma.confidentialRegistry.findMany();
      activeDeposits = await prisma.privacyDeposit.findMany({
        where: { spent: false }
      });
      totalShieldedLiquidity = activeDeposits.reduce((sum, dep) => sum + parseFloat(dep.amount || "0"), 0);

      const deployDir = path.join(process.cwd(), "public", "deploys");
      if (fs.existsSync(deployDir)) {
        const files = fs.readdirSync(deployDir).filter(f => f.startsWith("contract-") && f.endsWith(".md"));
        for (const file of files) {
          const content = fs.readFileSync(path.join(deployDir, file), "utf-8");
          const contractId = file.replace("contract-", "").replace(".md", "");
          
          const typeMatch = content.match(/-\s*\*Contract Type\*\*:\s*(.+)/i);
          const deployerMatch = content.match(/-\s*\*Deployer Public Key\*\*:\s*`?([A-Z0-9a-z]+)`?/i);
          
          // Parse additional properties for locks & cliffs
          const recipientMatch = content.match(/(?:Recipient|Beneficiary|Seller|Buyer)\s*(?:Address|Public Key)?\*\*:\s*`?([A-Z0-9a-z]+)`?/i);
          const lockMatch = content.match(/(?:Cliff|Deadline|Release|Timeout|Duration|Unlock|Lock)\s*(?:Time|Date|Duration|Period)?\*\*:\s*`?([^\n`\r]+)`?/i);

          contractsList.push({
            id: contractId,
            type: typeMatch ? typeMatch[1].trim() : "Unknown",
            deployer: deployerMatch ? deployerMatch[1].trim() : "Unknown",
            recipient: recipientMatch ? recipientMatch[1].trim() : null,
            lockDetails: lockMatch ? lockMatch[1].trim() : null,
            date: fs.statSync(path.join(deployDir, file)).birthtime.toLocaleDateString()
          });
        }
      }
    } catch (dbErr) {
      console.error("Failed to query DB stats for dashboard:", dbErr);
    }

    // Resolve balances for the recent users
    const usersWithBalances = await Promise.all(
      recentUsersList.map(async u => {
        let xlm = "0.00";
        let usdc = "0.00";
        
        const sessionRecord = await prisma.sessionState.findUnique({ where: { chatId: u.chatId } });
        let networkMode: "TESTNET" | "MAINNET" = process.env.STELLAR_NETWORK === "MAINNET" ? "MAINNET" : "TESTNET";
        if (sessionRecord) {
          const state = JSON.parse(sessionRecord.stateJson);
          if (state.networkMode === "MAINNET" || state.networkMode === "TESTNET") {
            networkMode = state.networkMode;
          }
        }

        try {
          const balances = await networkStorage.run(networkMode, () => getBalances(u.stellarPublic));
          xlm = parseFloat(balances.xlm).toFixed(2);
          usdc = parseFloat(balances.usdc).toFixed(2);
        } catch (e) {}
        return { ...u, xlm, usdc, networkMode };
      })
    );

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <html>
        <head>
          <title>📊 Stellapp Admin Dashboard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
          <style>
            :root {
              --bg: #fafafa;
              --card: #ffffff;
              --border: #eaeaea;
              --text: #111111;
              --text-muted: #666666;
              --primary: #000000;
              --secondary: #333333;
              --green: #00875a;
              --rose: #de350b;
            }
            body { 
              background: var(--bg); 
              color: var(--text); 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
              margin: 0; 
              padding: 40px 20px; 
              display: flex; 
              justify-content: center; 
            }
            .container { max-width: 1200px; width: 100%; }
            header { 
              display: flex; 
              justify-content: space-between; 
              align-items: center; 
              margin-bottom: 30px; 
              border-bottom: 1px solid var(--border); 
              padding-bottom: 20px; 
            }
            h1 { margin: 0; color: var(--primary); font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
            .status-badge { 
              background: #f1f3f4; 
              color: #3c4043; 
              border: 1px solid var(--border); 
              padding: 6px 14px; 
              border-radius: 6px; 
              font-size: 13px; 
              font-weight: 500; 
              display: flex; 
              align-items: center; 
              gap: 8px; 
            }
            .status-dot { 
              width: 8px; 
              height: 8px; 
              background: var(--green); 
              border-radius: 50%; 
            }
            .stats-grid { 
              display: grid; 
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
              gap: 20px; 
              margin-bottom: 30px; 
            }
            .stat-card { 
              background: var(--card); 
              border-radius: 8px; 
              padding: 20px; 
              border: 1px solid var(--border); 
              box-shadow: 0 1px 2px rgba(0,0,0,0.02); 
            }
            .stat-card h3 { margin: 0 0 10px 0; color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
            .stat-card .value { font-size: 26px; font-weight: 700; color: var(--primary); letter-spacing: -0.02em; }
            .stat-card .sub { color: var(--text-muted); font-size: 11px; margin-top: 5px; }

            /* Navigation Tabs */
            .tabs-nav {
              display: flex;
              gap: 20px;
              margin-bottom: 25px;
              border-bottom: 1px solid var(--border);
              padding-bottom: 0;
              overflow-x: auto;
            }
            .tab-btn {
              background: transparent;
              color: var(--text-muted);
              border: none;
              border-bottom: 2px solid transparent;
              padding: 12px 4px;
              cursor: pointer;
              font-weight: 500;
              font-size: 14px;
              transition: all 0.15s;
              white-space: nowrap;
            }
            .tab-btn:hover {
              color: var(--primary);
            }
            .tab-btn.active {
              color: var(--primary);
              border-bottom: 2px solid var(--primary);
              font-weight: 600;
            }
            .tab-content {
              display: none;
            }
            .tab-content.active {
              display: block;
            }

            .card { 
              background: var(--card); 
              border-radius: 8px; 
              padding: 24px; 
              border: 1px solid var(--border); 
              box-shadow: 0 1px 2px rgba(0,0,0,0.02);
              margin-bottom: 25px;
            }
            .section-title { font-size: 16px; color: var(--primary); margin: 0 0 20px 0; border-bottom: 1px solid var(--border); padding-bottom: 8px; font-weight: 600; }
            
            /* Table Styling */
            .data-table {
              width: 100%;
              border-collapse: collapse;
              text-align: left;
            }
            .data-table th {
              padding: 12px 16px;
              border-bottom: 1px solid var(--border);
              color: var(--text-muted);
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              font-weight: 600;
            }
            .data-table td {
              padding: 14px 16px;
              border-bottom: 1px solid var(--border);
              font-size: 14px;
            }
            .data-table tr:hover td {
              background: #f9fafb;
            }
            .data-table tr:last-child td {
              border-bottom: none;
            }
            .data-table td {
              border-bottom: 1px solid #f3f3f3;
              color: #333333;
            }
            .monospace {
              font-family: 'JetBrains Mono', monospace;
              font-size: 13px;
            }
            .addr-link {
              color: #0066cc;
              text-decoration: none;
            }
            .addr-link:hover {
              text-decoration: underline;
            }

            /* Badges */
            .badge {
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 500;
            }
            .badge-active {
              background: #e6f4ea;
              color: #137333;
            }
            .badge-inactive {
              background: #fce8e6;
              color: #c5221f;
            }
            .badge-neutral {
              background: #f1f3f4;
              color: #3c4043;
            }


            /* Reset & Config actions */
            .btn-action {
              padding: 10px 20px;
              border-radius: 6px;
              font-weight: 600;
              font-size: 14px;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
              transition: all 0.15s;
              border: 1px solid transparent;
            }
            .btn-danger {
              background: #000000;
              color: #ffffff;
              border-color: #000000;
            }
            .btn-danger:hover {
              background: #333333;
              border-color: #333333;
            }
            .btn-warning {
              background: #ffffff;
              color: #000000;
              border-color: #eaeaea;
            }
            .btn-warning:hover {
              background: #fafafa;
              border-color: #d1d1d1;
            }
            .no-data {
              text-align: center;
              color: var(--text-muted);
              font-size: 14px;
              padding: 30px 0;
            }
            .details-table {
              width: 100%;
              border-collapse: collapse;
            }
            .details-table td {
              padding: 8px 0;
              font-size: 14px;
              border-bottom: 1px solid var(--border);
            }
            .details-table tr:last-child td {
              border-bottom: none;
            }
            .details-table td.label {
              color: var(--text-muted);
              font-weight: 500;
              width: 40%;
            }
            .details-table td.val {
              color: var(--primary);
              font-family: 'JetBrains Mono', monospace;
              word-break: break-all;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <header>
              <div>
                <h1>Stellapp Dashboard</h1>
                <p style="color: var(--text-muted); margin: 5px 0 0 0; font-size: 14px;">Stellar WhatsApp AI Bot Administration</p>
              </div>
              <div style="display: flex; align-items: center; gap: 15px;">
                <div class="status-badge">
                  <span class="status-dot"></span> Active & Online
                </div>
                <form method="POST" action="/logout" style="display: inline;">
                  <button type="submit" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">Logout</button>
                </form>
              </div>
            </header>
            
            <div class="stats-grid">
              <div class="stat-card">
                <h3>Total Users</h3>
                <div class="value">${totalUsers}</div>
                <div class="sub">WhatsApp wallets generated</div>
              </div>
              <div class="stat-card">
                <h3>Onboarded</h3>
                <div class="value">${onboardedUsers}</div>
                <div class="sub">Completed profile username setup</div>
              </div>
              <div class="stat-card">
                <h3>Stellar Network</h3>
                <div class="value" style="color: var(--primary); font-size: 24px; padding: 4px 0;">${process.env.STELLAR_NETWORK || 'TESTNET'}</div>
                <div class="sub">${process.env.STELLAR_RPC_URL ? 'Soroban RPC Active' : 'Horizon Mode'}</div>
              </div>
              <div class="stat-card">
                <h3>ZK Pools</h3>
                <div class="value">${confidentialRegistries.length}</div>
                <div class="sub">Active privacy tokens wrapper</div>
              </div>
              <div class="stat-card">
                <h3>Shielded Liquidity</h3>
                <div class="value" style="color: var(--secondary);">${totalShieldedLiquidity.toFixed(2)} USDC</div>
                <div class="sub">Held in privacy pool contract</div>
              </div>
            </div>

            <!-- Navigation Tabs -->
            <div class="tabs-nav">
              <button class="tab-btn active" onclick="switchTab('users')">👥 Users & Balances</button>
              <button class="tab-btn" onclick="switchTab('contracts')">📜 Smart Contracts</button>
              <button class="tab-btn" onclick="switchTab('automation')">🔄 Automation Jobs</button>
              <button class="tab-btn" onclick="switchTab('zk')">🔒 ZK Shielded Registry</button>
            </div>

            <!-- Tab: Users & Balances -->
            <div id="tab-users" class="tab-content active">
              <div class="card">
                <h3 class="section-title">Registered User Wallets & Balances</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>User JID (WhatsApp ID)</th>
                      <th>Mapped Real Phone</th>
                      <th>Username</th>
                      <th>Active Network</th>
                      <th>Stellar Public Address</th>
                      <th>XLM Balance</th>
                      <th>USDC Balance</th>
                      <th>Joined Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${usersWithBalances.length === 0 ? `
                      <tr><td colspan="8" class="no-data">No users onboarded yet.</td></tr>
                    ` : usersWithBalances.map(u => {
                      const cleanJID = u.chatId.split("@")[0];
                      const secondary = (u.phoneNumber && u.phoneNumber !== cleanJID) ? `+${u.phoneNumber}` : "None";
                      const expUrl = config.explorerUrlStellar.replace("/tx/", "/account/") + u.stellarPublic;
                      return `
                        <tr>
                          <td class="monospace">+${cleanJID}</td>
                          <td>${secondary}</td>
                          <td>${u.username ? `<span class="badge badge-neutral">@${u.username}</span>` : 'None'}</td>
                          <td>${u.networkMode === "MAINNET" ? `<span class="badge badge-active">Mainnet</span>` : `<span class="badge badge-neutral">Testnet</span>`}</td>
                          <td class="monospace"><a href="${expUrl}" target="_blank" class="addr-link">${u.stellarPublic.substring(0, 8)}...${u.stellarPublic.substring(u.stellarPublic.length - 8)}</a></td>
                          <td class="monospace" style="color: var(--primary); font-weight: 500;">${u.xlm} XLM</td>
                          <td class="monospace" style="color: var(--secondary); font-weight: 500;">${u.usdc} USDC</td>
                          <td style="color: var(--text-muted);">${new Date(u.createdAt).toLocaleDateString()}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Tab: Smart Contracts -->
            <div id="tab-contracts" class="tab-content">
              <div class="card">
                <h3 class="section-title">Dynamically Compiled & Deployed Smart Contracts</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Stellar Contract ID</th>
                      <th>Contract Type</th>
                      <th>Deployer Public Address</th>
                      <th>Deployment Date</th>
                      <th>Specifications Document</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${contractsList.length === 0 ? `
                      <tr><td colspan="5" class="no-data">No custom smart contracts compiled or deployed yet.</td></tr>
                    ` : contractsList.map(c => {
                      const cUrl = `${config.explorerUrlStellarContract}${c.id}`;
                      const docUrl = `/deploys/contract-${c.id}.md`;
                      return `
                        <tr>
                          <td class="monospace"><a href="${cUrl}" target="_blank" class="addr-link">${c.id.substring(0, 8)}...${c.id.substring(c.id.length - 8)}</a></td>
                          <td><span class="badge badge-neutral" style="text-transform: uppercase;">${c.type}</span></td>
                          <td class="monospace">${c.deployer.substring(0, 8)}...${c.deployer.substring(c.deployer.length - 8)}</td>
                          <td>${c.date}</td>
                          <td><a href="${docUrl}" target="_blank" class="addr-link" style="font-weight: 500;">📄 View Deployment Specs</a></td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Tab: Automation Jobs -->
            <div id="tab-automation" class="tab-content">
              <!-- Contract Lock Watchers -->
              <div class="card">
                <h3 class="section-title">Contract Cliff & Lock Watchers</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Contract ID</th>
                      <th>Contract Type</th>
                      <th>Cliff / Lock Details</th>
                      <th>Recipient / Beneficiary</th>
                      <th>Watcher Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(() => {
                      const watchers = contractsList.filter(c => c.lockDetails);
                      if (watchers.length === 0) {
                        return '<tr><td colspan="5" class="no-data">No active contract locks or cliffs being watched.</td></tr>';
                      }
                      return watchers.map(w => {
                        const cUrl = `${config.explorerUrlStellarContract}${w.id}`;
                        const recSnippet = w.recipient ? `${w.recipient.substring(0, 8)}...${w.recipient.substring(w.recipient.length - 8)}` : "Unknown";
                        return `
                          <tr>
                            <td class="monospace"><a href="${cUrl}" target="_blank" class="addr-link">${w.id.substring(0, 8)}...${w.id.substring(w.id.length - 8)}</a></td>
                            <td><span class="badge badge-neutral" style="text-transform: uppercase;">${w.type}</span></td>
                            <td class="monospace" style="color: var(--rose); font-weight: 500;">${w.lockDetails}</td>
                            <td class="monospace">${w.recipient ? `<a href="${config.explorerUrlStellar.replace('/tx/', '/account/')}${w.recipient}" target="_blank" class="addr-link">${recSnippet}</a>` : 'N/A'}</td>
                            <td><span class="badge badge-active">👀 WATCHING</span></td>
                          </tr>
                        `;
                      }).join('');
                    })()}
                  </tbody>
                </table>
              </div>

              <!-- DCA Swaps -->
              <div class="card">
                <h3 class="section-title">Background Recurring Swap Jobs (DCA)</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>Owner JID</th>
                      <th>Swap Details</th>
                      <th>Interval</th>
                      <th>Progress</th>
                      <th>Status</th>
                      <th>Created Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recurringSwaps.length === 0 ? `
                      <tr><td colspan="7" class="no-data">No active DCA recurring swap jobs.</td></tr>
                    ` : recurringSwaps.map(j => {
                      return `
                        <tr>
                          <td class="monospace">${j.id.substring(0, 8)}...</td>
                          <td class="monospace">+${j.chatId.split("@")[0]}</td>
                          <td class="monospace" style="color: var(--primary);">${j.amountPerSwap} ${j.fromAsset} → ${j.toAsset}</td>
                          <td>${j.intervalSeconds}s</td>
                          <td class="monospace">${j.swapsCompleted} / ${j.totalSwaps}</td>
                          <td><span class="badge ${j.isActive ? 'badge-active' : 'badge-inactive'}">${j.isActive ? 'RUNNING' : 'COMPLETED/STOPPED'}</span></td>
                          <td>${new Date(j.createdAt).toLocaleDateString()}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Recurring Allowances -->
              <div class="card">
                <h3 class="section-title">Background Recurring Transfer Jobs (Allowances)</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>Owner JID</th>
                      <th>Recipient Address</th>
                      <th>Amount & Token</th>
                      <th>Interval</th>
                      <th>Progress</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recurringTransfers.length === 0 ? `
                      <tr><td colspan="7" class="no-data">No active recurring allowance jobs.</td></tr>
                    ` : recurringTransfers.map(j => {
                      return `
                        <tr>
                          <td class="monospace">${j.id.substring(0, 8)}...</td>
                          <td class="monospace">+${j.chatId.split("@")[0]}</td>
                          <td class="monospace">${j.recipientAddr.substring(0, 8)}...${j.recipientAddr.substring(j.recipientAddr.length - 8)} ${j.recipientName ? `(${j.recipientName})` : ''}</td>
                          <td class="monospace" style="color: var(--secondary);">${j.amountPerTransfer} ${j.assetCode}</td>
                          <td>${j.intervalSeconds}s</td>
                          <td class="monospace">${j.transfersCompleted} / ${j.totalTransfers}</td>
                          <td><span class="badge ${j.isActive ? 'badge-active' : 'badge-inactive'}">${j.isActive ? 'ACTIVE' : 'COMPLETED'}</span></td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Limit Orders -->
              <div class="card">
                <h3 class="section-title">Limit Orders (Price-Triggered Swaps)</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Owner JID</th>
                      <th>Sell Details</th>
                      <th>Target Price</th>
                      <th>Trigger Condition</th>
                      <th>Status</th>
                      <th>Created Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${limitOrders.length === 0 ? `
                      <tr><td colspan="7" class="no-data">No active price limit orders configured.</td></tr>
                    ` : limitOrders.map(o => {
                      return `
                        <tr>
                          <td class="monospace">${o.id.substring(0, 8)}...</td>
                          <td class="monospace">+${o.chatId.split("@")[0]}</td>
                          <td class="monospace" style="color: var(--primary);">${o.amount} ${o.fromAsset} → ${o.toAsset}</td>
                          <td class="monospace">${o.triggerPrice} USDC/XLM</td>
                          <td><span class="badge badge-neutral">${o.condition === 'LESS_THAN_OR_EQUAL' ? 'PRICE <=' : 'PRICE >= '}</span></td>
                          <td><span class="badge ${o.isActive ? 'badge-active' : 'badge-inactive'}">${o.isActive ? 'PENDING' : 'EXECUTED'}</span></td>
                          <td>${new Date(o.createdAt).toLocaleDateString()}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Tab: ZK Shielded Registry -->
            <div id="tab-zk" class="tab-content">
              <!-- Confidential Token Wrappers -->
              <div class="card">
                <h3 class="section-title">Confidential Token Wrappers (SEP-41 Soroban Contracts)</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Asset Code</th>
                      <th>Token Contract Address</th>
                      <th>ZK Verifier Address</th>
                      <th>ZK Auditor Address</th>
                      <th>Deployment Info</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${confidentialRegistries.length === 0 ? `
                      <tr><td colspan="5" class="no-data">No assets registered for ZK confidential transfers.</td></tr>
                    ` : confidentialRegistries.map(r => {
                      const tkUrl = `${config.explorerUrlStellarContract}${r.tokenContract}`;
                      const vfUrl = `${config.explorerUrlStellarContract}${r.verifierContract}`;
                      const auUrl = `${config.explorerUrlStellarContract}${r.auditorContract}`;
                      return `
                        <tr>
                          <td style="font-weight: bold; color: var(--secondary);">${r.assetCode}</td>
                          <td class="monospace"><a href="${tkUrl}" target="_blank" class="addr-link">${r.tokenContract.substring(0, 10)}...${r.tokenContract.substring(r.tokenContract.length - 10)}</a></td>
                          <td class="monospace"><a href="${vfUrl}" target="_blank" class="addr-link">${r.verifierContract.substring(0, 10)}...${r.verifierContract.substring(r.verifierContract.length - 10)}</a></td>
                          <td class="monospace"><a href="${auUrl}" target="_blank" class="addr-link">${r.auditorContract.substring(0, 10)}...${r.auditorContract.substring(r.auditorContract.length - 10)}</a></td>
                          <td><span class="badge badge-neutral">ACTIVE</span></td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Unspent Deposits -->
              <div class="card">
                <h3 class="section-title">Active Shielded ZK Commitments (Unspent Privacy Deposits)</h3>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Deposit ID</th>
                      <th>Contract ID</th>
                      <th>Asset</th>
                      <th>Shielded Amount</th>
                      <th>Pedersen Commitment Hash</th>
                      <th>Merkle Leaf Index</th>
                      <th>Deposited Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${activeDeposits.length === 0 ? `
                      <tr><td colspan="7" class="no-data">No unspent deposits inside the ZK privacy pool.</td></tr>
                    ` : activeDeposits.map(d => {
                      return `
                        <tr>
                          <td class="monospace">${d.id.substring(0, 8)}...</td>
                          <td class="monospace">${d.contractId.substring(0, 8)}...${d.contractId.substring(d.contractId.length - 8)}</td>
                          <td style="font-weight: 500;">${d.assetCode}</td>
                          <td class="monospace" style="color: var(--secondary);">${d.amount}</td>
                          <td class="monospace" style="font-size: 11px;">${d.commitmentHex.substring(0, 16)}...${d.commitmentHex.substring(d.commitmentHex.length - 16)}</td>
                          <td class="monospace">${d.leafIndex}</td>
                          <td>${new Date(d.createdAt).toLocaleDateString()}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>


            <!-- Control System Settings -->
            <div class="card">
              <h3 class="section-title">System Configuration & Administrative Diagnostics</h3>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                <div>
                  <table class="details-table" style="margin-bottom: 0;">
                    <tr>
                      <td class="label" style="padding: 8px 0;">Stellar Horizon</td>
                      <td class="val" style="padding: 8px 0; font-size: 13px;">${process.env.STELLAR_HORIZON_URL || 'Horizon offline'}</td>
                    </tr>
                    <tr>
                      <td class="label" style="padding: 8px 0;">USDC Asset Code</td>
                      <td class="val" style="padding: 8px 0; font-size: 13px;">${process.env.USDC_ASSET_CODE || 'USDC'}</td>
                    </tr>

                  </table>
                </div>
                <div style="display: flex; flex-direction: column; gap: 10px; justify-content: center;">
                  <div style="display: flex; gap: 10px;">
                    <form method="POST" action="/action" style="flex: 1; display: flex;" onsubmit="return confirm('Are you sure you want to disconnect the active WhatsApp session cache? You will need to scan a new QR code.')">
                      <input type="hidden" name="action" value="reset" />
                      <button type="submit" class="btn-action btn-danger" style="flex: 1; text-align: center; border: none; cursor: pointer;">♻️ Reset JID Cache</button>
                    </form>
                    <form method="POST" action="/action" style="flex: 1; display: flex;" onsubmit="return confirm('⚠️ WARNING: This will permanently wipe all users, contacts, and transactions. Continue?')">
                      <input type="hidden" name="action" value="clear-db" />
                      <button type="submit" class="btn-action btn-warning" style="flex: 1; text-align: center; border: none; cursor: pointer;">🗑️ Wipe Database</button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <script>
            function switchTab(tabId) {
              document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
              document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
              
              const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
              if (btn) btn.classList.add('active');
              
              const content = document.getElementById('tab-' + tabId);
              if (content) content.classList.add('active');
                          }
          </script>
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
                    <button style="margin-top:15px; background:#475569;" onclick="window.location.href = '/dashboard'">Reset / Go Back</button>
                  </div>
                ` : `
                  <form method="GET" style="width: 100%;">
                    <label style="display:block; font-size:13px; color:#94a3b8; margin-bottom:5px;">Phone Number (International Format)</label>
                    <input type="text" name="phone" placeholder="e.g. 919876543210" required />
                    <button type="submit">Generate Pairing Code</button>
                  </form>
                `}
              </div>
            </div>
            <div style="text-align:center; margin-top:30px;">
              <form method="POST" action="/action" style="display: inline;" onsubmit="return confirm('Are you sure you want to disconnect the active WhatsApp session cache? You will need to scan a new QR code.')">
                <input type="hidden" name="action" value="reset" />
                <button type="submit" style="background: none; border: 1px dashed #475569; padding: 6px 12px; border-radius: 6px; color:#64748b; font-size:13px; cursor: pointer; display: inline-block; transition: all 0.2s;" onmouseover="this.style.color='#f87171'; this.style.borderColor='#f87171';" onmouseout="this.style.color='#64748b'; this.style.borderColor='#475569';">♻️ Stale QR or Sync Hung? Reset and Generate Fresh QR</button>
              </form>
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
