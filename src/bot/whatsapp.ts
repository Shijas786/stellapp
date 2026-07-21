import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import os from "os";
import { handleIncomingMessage } from "./controller";
import { transcribeAudio, generateSpeech, injectContextMessage } from "../agent/agent";
import { prisma } from "../services/db";

function chmodRecursive(dirPath: string) {
  try {
    const stat = fs.statSync(dirPath);
    if (stat.isDirectory()) {
      fs.chmodSync(dirPath, 0o700);
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        chmodRecursive(path.join(dirPath, file));
      }
    } else {
      fs.chmodSync(dirPath, 0o600);
    }
  } catch (err: any) {
    console.warn(`[WhatsApp] Failed to set permissions on ${dirPath}:`, err.message);
  }
}

export class WhatsAppBot {
  private client: Client;

  constructor() {
    if (process.env.WIPE_WHATSAPP_SESSION === "true") {
      console.log("[Wipe] WIPE_WHATSAPP_SESSION is true. Deleting all auth folders to start fresh...");
      try {
        const volumePath = path.join(process.cwd(), ".wwebjs_auth");
        const tempPath = "/tmp/wwebjs_auth";
        if (fs.existsSync(volumePath)) {
          fs.rmSync(volumePath, { recursive: true, force: true });
        }
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { recursive: true, force: true });
        }
        console.log("[Wipe] WhatsApp session auth folders successfully deleted!");
      } catch (err: any) {
        console.error("[Wipe] Failed to delete auth folders:", err.message);
      }
    }

    // Restore session from persistent volume to local /tmp before starting Puppeteer.
    // Chromium SQLite/LevelDB database files will crash if run directly on some Docker volume mounts due to locking limitations.
    const volumePath = path.join(process.cwd(), ".wwebjs_auth");
    const tempPath = "/tmp/wwebjs_auth";
    const volumeSession = path.join(volumePath, "session");
    const tempSession = path.join(tempPath, "session");

    if (fs.existsSync(volumeSession)) {
      console.log("[WhatsApp Sync] Restoring session from persistent volume to local /tmp...");
      try {
        fs.mkdirSync(tempSession, { recursive: true });
        fs.cpSync(volumeSession, tempSession, { recursive: true, force: true });
        console.log("[WhatsApp Sync] Session restoration complete.");
      } catch (cpErr: any) {
        console.error("[WhatsApp Sync] Failed to restore session to /tmp:", cpErr.message);
      }
    }

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: "/tmp/wwebjs_auth"
      }),
      authTimeoutMs: 60000,
      webVersion: "2.3000.1043180520-alpha",
      webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html"
      },
      puppeteer: {
        headless: true,
        dumpio: true, // diagnostic: pipe Chromium stderr to Railway logs
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // Let Puppeteer use its own bundled Chrome if undefined
        timeout: 60000,
        protocolTimeout: 180000, // 3 minutes to accommodate heavy CPU ZK proof generation without timing out
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-dbus",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--renderer-process-limit=2",
          "--disable-extensions",
          "--disable-default-apps",
          "--disable-translate",
          "--disable-sync",
          "--mute-audio"
        ]
      }
    });

    this.setupListeners();

    // Periodic sync back to the volume every 5 minutes
    setInterval(() => {
      this.syncSessionToVolume();
    }, 5 * 60 * 1000);

    // Shutdown hooks to back up session to volume
    process.on("SIGTERM", () => {
      console.log("[WhatsApp Sync] SIGTERM received. Syncing session...");
      this.syncSessionToVolume();
    });
    process.on("SIGINT", () => {
      console.log("[WhatsApp Sync] SIGINT received. Syncing session...");
      this.syncSessionToVolume();
    });
  }

  private cleanLockFiles() {
    try {
      const pathsToClean = [
        path.join(process.cwd(), ".wwebjs_auth"),
        "/tmp/wwebjs_auth"
      ];

      for (const authDir of pathsToClean) {
        if (!fs.existsSync(authDir)) continue;

        // Recursively set secure permissions (700 for directories, 600 for files)
        // to prevent other local users/processes on the host from reading session tokens.
        chmodRecursive(authDir);
        console.log(`[WhatsApp] Successfully secured file permissions on directory: ${authDir}`);

        // Specifically remove all Chromium lock files that cause the "profile appears to be in use" (Code 21) crash loop
        const sessionDirs = [
          path.join(authDir, "session"),
          path.join(authDir, "session/Default")
        ];

        for (const sDir of sessionDirs) {
          if (fs.existsSync(sDir)) {
            try {
              const files = fs.readdirSync(sDir);
              for (const file of files) {
                if (file.startsWith("Singleton") || file === "lockfile" || file === "Lock") {
                  const lockPath = path.join(sDir, file);
                  console.log(`[WhatsApp] Stale lock file found: ${lockPath}. Removing it...`);
                  try {
                    fs.unlinkSync(lockPath);
                  } catch (unlinkErr: any) {
                    // If it is a directory or symlink that unlinkSync fails on, try to delete it
                    fs.rmSync(lockPath, { recursive: true, force: true });
                  }
                }
              }
            } catch (e: any) {
              console.warn(`[WhatsApp] Could not clean lock files in ${sDir}:`, e.message);
            }
          }
        }
      }
    } catch (err: any) {
      console.error("[WhatsApp] Failed to clean browser lock files or permissions:", err.message);
    }
  }

  private setupListeners() {
    this.client.on("qr", (qr) => {
      // Store QR globally so the HTTP endpoint in index.ts can serve it as a scannable image
      (global as any).__latestQR = qr;
      // Also log raw QR string to Railway console as fallback
      console.log("\n[WhatsApp] New QR code generated. Visit your Railway URL to scan it.");
      console.log("[WhatsApp] Raw QR (for local debug):", qr.substring(0, 40) + "...");
    });

    this.client.on("loading_screen", (percent, message) => {
      console.log(`[WhatsApp Loading] Progress: ${percent}% - ${message}`);
    });

    this.client.on("ready", () => {
      (global as any).__latestQR = null; // Clear QR — session is now active
      console.log("\n[WhatsApp] Client is connected and ready to process messages!");
      this.syncSessionToVolume();
    });

    this.client.on("authenticated", () => {
      (global as any).__latestQR = null; // Clear QR immediately on authentication
      console.log("[WhatsApp] Session authenticated successfully.");
      this.syncSessionToVolume();
    });

    this.client.on("auth_failure", (msg) => {
      console.error("[WhatsApp] Authentication failure:", msg);
    });

    this.client.on("disconnected", (reason) => {
      console.error("[WhatsApp] Client was disconnected:", reason);
      console.log("[WhatsApp] Exiting process so Railway restarts with a clean browser session...");
      process.exit(1);
    });

    this.client.on("change_state", (state) => {
      console.log("[WhatsApp] State changed:", state);
    });

    this.client.on("message", async (msg) => {
      console.log(`[WhatsApp] Received message event: from=${msg.from}, body=${msg.body ? msg.body.substring(0, 60) : ""}, type=${msg.type}`);
      
      try {
        const isGroup = msg.from.endsWith("@g.us");
        if (isGroup) {
          console.log(`[WhatsApp] Ignoring group message from: ${msg.from}`);
          return;
        }

        const isIndividualChat = msg.from.endsWith("@c.us") || msg.from.endsWith("@lid");
        if (!isIndividualChat) {
          console.log(`[WhatsApp] Ignoring unknown message format from: ${msg.from}`);
          return;
        }

        const originalSenderId = msg.author || msg.from;
        let senderId = originalSenderId;
        let contactNumber = "";

        if (originalSenderId.endsWith("@lid")) {
          try {
            console.log(`[WhatsApp] Resolving LID ${originalSenderId} mapping...`);
            const mapping = await this.client.getContactLidAndPhone([originalSenderId]);
            if (mapping && mapping[0] && mapping[0].pn) {
              senderId = mapping[0].pn;
              contactNumber = mapping[0].pn.split("@")[0];
              console.log(`[WhatsApp] Successfully mapped LID ${originalSenderId} to canonical JID: ${senderId} (PN: ${contactNumber})`);
            }
          } catch (lidErr: any) {
            console.error("[WhatsApp] Failed to map LID to PN:", lidErr.message);
          }
        }

        let text = msg.body;
        let isVoice = false;

        // Check if message is a contact card
        if (msg.type === "vcard" || msg.type === "multi_vcard") {
          console.log(`[WhatsApp] Received vCard message.`);
          
          let vCards: string[] = [];
          if (msg.type === "vcard" && msg.body) {
            vCards.push(msg.body);
          } else if (msg.vCards && msg.vCards.length > 0) {
            vCards = msg.vCards;
          }

          if (vCards.length > 0) {
            let savedCount = 0;
            // Fetch user using mapped JID to unify database profiles under canonical JIDs
            const user = await prisma.user.findUnique({
              where: { chatId: senderId }
            });
            
            if (!user) {
              await msg.reply("⚠️ You must be registered (have sent at least one normal message) to save contacts.");
              return;
            }

            for (const vcard of vCards) {
              const nameMatch = vcard.match(/FN:(.+)/);
              const name = nameMatch ? nameMatch[1].trim() : "Unknown";
              
              let phoneNumber = "";
              const waidMatch = vcard.match(/waid=([0-9]+)/);
              if (waidMatch) {
                phoneNumber = waidMatch[1];
              } else {
                const telMatch = vcard.match(/TEL.*:(.+)/);
                if (telMatch) {
                  phoneNumber = telMatch[1].replace(/[\s\-+]/g, "");
                }
              }

              if (phoneNumber) {
                const cleanNewPhone = phoneNumber.replace(/[\s\-+]/g, "");
                
                // Find existing contact with this number saved by this user to avoid duplicates
                const existingContacts = await prisma.contact.findMany({
                  where: { ownerId: user.id }
                });
                
                const existing = existingContacts.find(c => {
                  const dbPhone = c.phoneNumber.replace(/[\s\-+]/g, "");
                  const minLen = Math.min(dbPhone.length, cleanNewPhone.length);
                  return minLen >= 7 && dbPhone.slice(-minLen) === cleanNewPhone.slice(-minLen);
                });

                if (existing) {
                  console.log(`[WhatsApp] Updating existing contact: "${existing.name}" -> "${name.toLowerCase()}" for number ${phoneNumber}`);
                  await prisma.contact.update({
                    where: { id: existing.id },
                    data: { name: name.toLowerCase(), phoneNumber }
                  });
                } else {
                  await prisma.contact.upsert({
                    where: { ownerId_name: { ownerId: user.id, name: name.toLowerCase() } },
                    update: { phoneNumber },
                    create: { ownerId: user.id, name: name.toLowerCase(), phoneNumber }
                  });
                }
                savedCount++;
                await msg.reply(`✅ Saved *${name}* (+${phoneNumber}) to your address book!`);
                
                await injectContextMessage(
                  senderId,
                  `I just saved a new contact: *${name}* with phone number +${phoneNumber}. If the user refers to "him", "her", or "them" in their next message, they almost certainly mean ${name} (+${phoneNumber}).`
                );
              }
            }
            if (savedCount > 0) return;
          }
        }

        if (msg.type === "ptt" || msg.type === "audio") {
          if (msg.hasMedia) {
            isVoice = true;
            console.log(`[WhatsApp] Received voice message. Downloading...`);
            
            // FIX: WhatsApp Web's latest version minified `_serialized` to `$1` (or similar).
            // `downloadMedia` relies on `this.id._serialized`, which is undefined, causing "r: r" errors.
            // We reconstruct it manually if it's missing.
            if (!msg.id._serialized) {
              const fromMe = msg.id.fromMe ? "true" : "false";
              const remote = msg.id.remote || msg.from;
              const id = msg.id.id;
              msg.id._serialized = `${fromMe}_${remote}_${id}`;
              console.log(`[WhatsApp Fix] Reconstructed missing _serialized ID: ${msg.id._serialized}`);
            }

            let media: any = null;
            let downloadError: any = null;
            
            // Implement retry logic with exponential backoff for media download
            const maxRetries = 2;
            const baseDelay = 1500;
            
            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
              try {
                media = await msg.downloadMedia();
                if (media) {
                  console.log(`[WhatsApp] Successfully downloaded voice message on attempt ${attempt}`);
                  break;
                }
                console.warn(`[WhatsApp] Attempt ${attempt}: downloadMedia returned undefined`);
              } catch (err: any) {
                downloadError = err;
                console.warn(`[WhatsApp] Attempt ${attempt}: downloadMedia failed:`, err.stack || err);
                if (this.client.pupPage) {
                  try {
                    // Log the msg object properties from whatsapp-web.js
                    console.log(`[WhatsApp Diagnostic] msg object properties:`, JSON.stringify({
                      id: msg.id,
                      isEphemeral: msg.isEphemeral,
                      isStatus: msg.isStatus,
                      isForwarded: msg.isForwarded,
                      broadcast: msg.broadcast,
                      from: msg.from,
                      to: msg.to,
                      author: msg.author,
                      deviceType: msg.deviceType,
                      type: msg.type,
                      hasMedia: msg.hasMedia
                    }, null, 2));

                    const info = await this.client.pupPage.evaluate((msgId, lid, trueJid) => {
                      const Store = (window as any).require('WAWebCollections');
                      if (!Store || !Store.Msg) return { error: "Store.Msg not found" };

                      const searchResult: any = { requestedId: msgId, lid, trueJid };
                      let m = Store.Msg.get(msgId);
                      
                      if (m) {
                        searchResult.found = true;
                        searchResult.method = "exact_id";
                      } else {
                        // Try replacing LID with trueJid in msgId if they differ
                        if (lid && trueJid && lid !== trueJid && msgId.includes(lid)) {
                          const altId = msgId.replace(lid, trueJid);
                          m = Store.Msg.get(altId);
                          if (m) {
                            searchResult.found = true;
                            searchResult.method = "replaced_lid";
                            searchResult.altId = altId;
                          }
                        }

                        // Still not found? Search by hash/suffix (last part of the ID)
                        if (!m) {
                          const parts = msgId.split("_");
                          const hash = parts[parts.length - 1];
                          if (hash && hash.length > 10) { // ensures it's a real hash
                            const allMsgs = Store.Msg.models || [];
                            for (let i = 0; i < allMsgs.length; i++) {
                              const model = allMsgs[i];
                              if (model.id && model.id._serialized && model.id._serialized.endsWith(hash)) {
                                m = model;
                                searchResult.found = true;
                                searchResult.method = "suffix_match";
                                searchResult.foundId = model.id._serialized;
                                break;
                              }
                            }
                          }
                        }
                      }

                      if (!m) {
                        searchResult.error = "Message completely not found in Store.Msg by any method";
                        return searchResult;
                      }
                      
                      searchResult.messageDetails = {
                        id: m.id._serialized,
                        type: m.type,
                        mediaStage: m.mediaData ? m.mediaData.mediaStage : "no mediaData",
                        hasDirectPath: !!m.directPath,
                        hasEncFilehash: !!m.encFilehash,
                        hasFilehash: !!m.filehash,
                        hasMediaKey: !!m.mediaKey,
                        mimetype: m.mimetype,
                        size: m.size,
                        isEphemeral: m.isEphemeral,
                        isBroadcast: m.isBroadcast,
                        isChannel: m.isChannel,
                        isGroupMsg: m.isGroupMsg,
                        author: m.author ? m.author._serialized : null,
                        from: m.from ? m.from._serialized : null
                      };

                      return searchResult;
                    }, msg.id._serialized, msg.from, senderId);
                    
                    console.log(`[WhatsApp Diagnostic] Message details from browser:`, JSON.stringify(info, null, 2));
                  } catch (diagErr: any) {
                    console.warn(`[WhatsApp Diagnostic] Failed to extract diagnostic info:`, diagErr.message);
                  }
                }
              }
              if (attempt <= maxRetries) {
                const delay = baseDelay * attempt;
                console.log(`[WhatsApp] Waiting ${delay}ms before retrying download...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
            
            if (!media) {
              const isLid = msg.from.includes("@lid") || (msg.author && msg.author.includes("@lid"));
              if (isLid) {
                await this.client.sendMessage(senderId, "⚠️ Sorry, I could not process your voice note due to a WhatsApp Web limitation affecting privacy-masked Linked IDs (@lid).\n\nPlease try sending a text message or a regular audio file here instead!");
              } else {
                await this.client.sendMessage(senderId, "⚠️ Received a voice message, but was unable to retrieve the audio data. Please try sending it again or send it as a regular audio file.");
              }
              return;
            }
            
            // Extract the file extension from the mime type (e.g. audio/ogg; codecs=opus -> ogg)
            const extension = media.mimetype.split("/")[1]?.split(";")[0] || "ogg";
            const tempFilePath = path.join(os.tmpdir(), `voice-${Date.now()}.${extension}`);
            
            fs.writeFileSync(tempFilePath, Buffer.from(media.data, "base64"));
            
            // Transcribe using OpenAI Whisper API
            text = await transcribeAudio(tempFilePath);
            
            try {
              fs.unlinkSync(tempFilePath);
            } catch (e) {
              console.error("Failed to delete temp audio file:", e);
            }
          } else {
            await msg.reply("⚠️ Received a voice message, but was unable to retrieve the audio data.");
            return;
          }
        }

        if (!text || text.trim() === "") {
          return; // Ignore empty message strings
        }

        console.log(`[WhatsApp] Processing input for ${senderId}: "${text}"`);
        let contactName = "";
        try {
          const contact = await msg.getContact();
          contactName = contact.pushname || contact.name || "";
          
          if (!contactNumber) {
            contactNumber = contact.number || "";
          }
        } catch (err: any) {
          console.error("Failed to retrieve contact details:", err.message);
        }

        let chat;
        try {
          chat = await msg.getChat();
          if (isVoice) {
            await chat.sendStateRecording();
          } else {
            await chat.sendStateTyping();
          }
        } catch (err: any) {
          console.error("Failed to set chat state:", err.message);
        }

        let response = await handleIncomingMessage(senderId, text, contactName, contactNumber);
        
        if (chat) {
          try {
            await chat.clearState();
          } catch (e) {}
        }
        
        if (response) {
          const { text: responseText, imagePath, redactAfterMs } = response;
          let textToReply = responseText;
          if (isVoice) {
            textToReply = `🎤 _" ${text} "_\n\n${responseText}`;
          }

          let sentMsgObj;

          // If an image is attached (e.g. onboarding banner), send as one message with caption
          if (imagePath) {
            try {
              const media = MessageMedia.fromFilePath(imagePath);
              sentMsgObj = await this.client.sendMessage(senderId, media, { caption: textToReply });
            } catch (imgErr: any) {
              console.error(`[WhatsApp] Failed to send onboarding image:`, imgErr.message);
              // Fallback: send text only
              sentMsgObj = await this.client.sendMessage(senderId, textToReply);
            }
          } else {
            // No image — send text reply normally
            sentMsgObj = await this.client.sendMessage(senderId, textToReply);
          }

          if (redactAfterMs && sentMsgObj) {
            console.log(`[WhatsApp] Scheduling message ${sentMsgObj.id._serialized} to be redacted in ${redactAfterMs}ms`);
            setTimeout(async () => {
              try {
                console.log(`[WhatsApp] Redacting message ${sentMsgObj.id._serialized} for security...`);
                const redactedText = `🔑 *Wallet Export Details*\n\n🔒 *[Expired & Redacted for Security]*\n\nThe private key displayed in this message has been automatically cleared for your safety.`;
                await sentMsgObj.edit(redactedText);
              } catch (redactErr: any) {
                console.error(`[WhatsApp] Failed to auto-redact message:`, redactErr.message);
              }
            }, redactAfterMs);
          }

          // If the user messaged us via voice, we talk back to them!
          if (isVoice) {
            try {
              if (chat) {
                await chat.sendStateRecording();
              }
              console.log(`[WhatsApp] Generating voice message reply for ${senderId}...`);
              const tempSpeechPath = path.join(os.tmpdir(), `speech-${Date.now()}.ogg`);
              
              // Clean response text from markdown symbols so it sounds natural
              const cleanText = responseText
                .replace(/[\*\_`#\-•]/g, "") // remove formatting marks
                .replace(/https?:\/\/\S+/g, "link") // replace urls with "link"
                .substring(0, 400); // limit speech content for low latency
              
              // If the original text was longer, append a note so user knows to check the text message
              const wasTruncated = responseText.replace(/[\*\_`#\-•]/g, "").replace(/https?:\/\/\S+/g, "link").length > 400;
              const speechText = wasTruncated ? cleanText + "... See the text message for the full details." : cleanText;
              
              await generateSpeech(speechText, tempSpeechPath);
              
              const speechMedia = MessageMedia.fromFilePath(tempSpeechPath);
              await this.client.sendMessage(senderId, speechMedia, { sendAudioAsVoice: true });
              
              try {
                fs.unlinkSync(tempSpeechPath);
              } catch (e) {
                console.error("Failed to delete temp speech file:", e);
              }
              if (chat) {
                try {
                  await chat.clearState();
                } catch (e) {}
              }
            } catch (ttsError: any) {
              console.error("[WhatsApp] Failed to generate and send voice note response:", ttsError.message);
              if (chat) {
                try {
                  await chat.clearState();
                } catch (e) {}
              }
            }
          }
        }
      } catch (error: any) {
        console.error(`[WhatsApp] Error processing message from ${msg.from}:`, error.stack || error);
        try {
          await msg.reply("⚠️ Sorry, I encountered an internal error processing that request. Please try again.");
        } catch (replyErr: any) {
          console.error("Failed to send error reply:", replyErr.message);
        }

        const errMsg = String(error.message || "").toLowerCase();
        // Only restart for Puppeteer protocol-level browser crashes, NOT for generic
        // API/RPC/database timeouts (which would cause unnecessary container restarts)
        const isPuppeteerCrash =
          errMsg.includes("callfunctionon") ||
          errMsg.includes("protocol error") ||
          errMsg.includes("session closed") ||
          errMsg.includes("detached frame") ||
          errMsg.includes("target closed");
        if (isPuppeteerCrash) {
          console.error("[WhatsApp] Puppeteer browser crash detected. Restarting container to heal...");
          process.exit(1);
        }
      }
    });

    this.client.on("message_create", (msg) => {
      // Trace outgoing and incoming events
      console.log(`[WhatsApp Link Trace] Message created: from=${msg.from}, to=${msg.to}, body=${msg.body ? msg.body.substring(0, 40) : ""}`);
    });
  }

  public initialize() {
    console.log("[WhatsApp] Initializing connection client...");
    this.cleanLockFiles();
    


    this.client.initialize().catch((err) => {
      console.error("[WhatsApp] Failed to initialize client:", err.message);
      
      // Self-healing: if the session data is corrupted or locked, clear it so it starts clean on next reboot
      if (
        err.message.includes("Execution context was destroyed") || 
        err.message.includes("profile appears to be in use") ||
        err.message.includes("Protocol error")
      ) {
        console.warn("[WhatsApp Self-Healing] Session corruption or locking detected. Clearing session data...");
        try {
          const volumePath = path.join(process.cwd(), ".wwebjs_auth");
          const tempPath = "/tmp/wwebjs_auth";
          fs.rmSync(path.join(volumePath, "session"), { recursive: true, force: true });
          fs.rmSync(path.join(tempPath, "session"), { recursive: true, force: true });
          console.log("[WhatsApp Self-Healing] Session data cleared successfully.");
        } catch (clearErr: any) {
          console.error("[WhatsApp Self-Healing] Failed to clear session data:", clearErr.message);
        }
      }

      // Exit the process so Railway automatically restarts and retries
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Watchdog to intercept page targets and override Storage APIs on load
    const bindInterval = setInterval(async () => {
      if (this.client.pupBrowser) {
        clearInterval(bindInterval);
        console.log("[WhatsApp] Puppeteer browser detected. Binding interceptors...");
        try {
          const browser = this.client.pupBrowser;

          const configurePage = async (page: any, source: string) => {
            console.log(`[WhatsApp] Configuring page overrides (${source})...`);
            try {
              // Inject storage overrides before any site scripts execute
              await page.evaluateOnNewDocument(() => {
                if (navigator.storage) {
                  // Bypass aquire-persistent-storage-denied by returning true directly
                  navigator.storage.persist = () => Promise.resolve(true);
                  navigator.storage.persisted = () => Promise.resolve(true);
                }
              });

              // Apply immediately to the current context
              await page.evaluate(() => {
                if (navigator.storage) {
                  navigator.storage.persist = () => Promise.resolve(true);
                  navigator.storage.persisted = () => Promise.resolve(true);
                }
              }).catch(() => {});
              
              // Connect console logs
              page.on("console", (msg: any) => {
                const txt = msg.text();
                if (msg.type() === "error" || txt.includes("failed") || txt.includes("Error") || txt.includes("warning")) {
                  console.log(`[Browser Console ${msg.type().toUpperCase()}] ${txt}`);
                }
              });
              
              page.on("pageerror", (err: any) => {
                console.error("[Browser Page Exception]", err.message);
              });
            } catch (evalErr: any) {
              console.error(`[WhatsApp] Failed page configuration (${source}):`, evalErr.message);
            }
          };

          // Apply to existing page immediately
          const existingPages = await browser.pages();
          for (const page of existingPages) {
            await configurePage(page, "existing");
          }
          
          // Apply to future pages
          browser.on("targetcreated", async (target) => {
            if (target.type() === "page") {
              const page = await target.page();
              if (page) {
                await configurePage(page, "new target");
              }
            }
          });
        } catch (e: any) {
          console.error("[WhatsApp] Error setting up browser monitors:", e.message);
        }
      }
    }, 50);
  }


  public async sendMessage(chatId: string, text: string): Promise<string> {
    const sentMsg = await this.client.sendMessage(chatId, text);
    if (!sentMsg || !sentMsg.id) {
      console.warn(`[WhatsApp] sendMessage returned undefined/null for ${chatId}. Returning fallback ID.`);
      return `msg_fallback_${Date.now()}`;
    }
    return sentMsg.id._serialized;
  }

  public async editMessage(chatId: string, messageId: string, newText: string): Promise<void> {
    try {
      const msg = await this.client.getMessageById(messageId);
      await msg.edit(newText);
    } catch (err: any) {
      console.error(`[WhatsApp] Failed to edit message ${messageId}:`, err.message);
    }
  }

  public async sendTypingState(chatId: string): Promise<void> {
    try {
      const chat = await this.client.getChatById(chatId);
      await chat.sendStateTyping();
    } catch (err: any) {
      console.error(`[WhatsApp] Failed to send typing state to ${chatId}:`, err.message);
    }
  }

  public async sendImageMessage(chatId: string, imagePath: string, caption?: string): Promise<void> {
    try {
      const media = MessageMedia.fromFilePath(imagePath);
      await this.client.sendMessage(chatId, media, { caption });
    } catch (err: any) {
      console.error(`[WhatsApp] Failed to send image to ${chatId}:`, err.message);
    }
  }

  public async sendDocumentMessage(chatId: string, filePath: string, caption?: string): Promise<void> {
    try {
      const media = MessageMedia.fromFilePath(filePath);
      await this.client.sendMessage(chatId, media, { caption, sendMediaAsDocument: true });
    } catch (err: any) {
      console.error(`[WhatsApp] Failed to send document to ${chatId}:`, err.message);
    }
  }

  public async getPairingCode(phoneNumber: string): Promise<string> {
    console.log(`[WhatsApp] Requesting pairing code for: ${phoneNumber}`);
    return await this.client.requestPairingCode(phoneNumber);
  }

  private syncSessionToVolume() {
    try {
      const volumePath = path.join(process.cwd(), ".wwebjs_auth");
      const tempPath = "/tmp/wwebjs_auth";
      const volumeSession = path.join(volumePath, "session");
      const tempSession = path.join(tempPath, "session");

      if (fs.existsSync(tempSession)) {
        console.log("[WhatsApp Sync] Backing up session from local /tmp to persistent volume...");
        fs.mkdirSync(volumeSession, { recursive: true });

        // Clean stale lock files in /tmp before backing up so they are not copied to the volume
        const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
        for (const file of lockFiles) {
          try {
            const file1 = path.join(tempSession, file);
            if (fs.existsSync(file1)) fs.unlinkSync(file1);
            const file2 = path.join(tempSession, "Default", file);
            if (fs.existsSync(file2)) fs.unlinkSync(file2);
          } catch (e) {}
        }

        try {
          fs.cpSync(tempSession, volumeSession, { recursive: true, force: true, dereference: false });
        } catch (cpErr: any) {
          console.warn("[WhatsApp Sync] Native backup cpSync failed, error details:", cpErr.message);
        }
        console.log("[WhatsApp Sync] Session backup completed successfully.");
      }
    } catch (err: any) {
      console.error("[WhatsApp Sync] Failed to backup session to volume:", err.message);
    }
  }
}
