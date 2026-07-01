import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import os from "os";
import { handleIncomingMessage } from "./controller";
import { transcribeAudio, generateSpeech } from "../agent/agent";

export class WhatsAppBot {
  private client: Client;

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: ".wwebjs_auth"
      }),
      authTimeoutMs: 60000,
      puppeteer: {
        headless: true,
        timeout: 60000,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--renderer-process-limit=2"
        ]
      }
    });

    this.setupListeners();
  }

  private cleanLockFiles() {
    try {
      const authDir = path.join(process.cwd(), ".wwebjs_auth");
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      // Recursively grant read/write/execute permissions to prevent permission-denied storage errors inside Docker
      try {
        const { execSync } = require("child_process");
        execSync(`chmod -R 777 "${authDir}"`);
        console.log("[WhatsApp] Successfully set write permissions on auth directory.");
      } catch (chmodErr: any) {
        console.warn("[WhatsApp] Failed to recursively set permissions:", chmodErr.message);
      }

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
              if (file.startsWith("Singleton")) {
                const lockPath = path.join(sDir, file);
                console.log(`[WhatsApp] Stale lock file found: ${lockPath}. Removing it...`);
                fs.unlinkSync(lockPath);
              }
            }
          } catch (e: any) {
            console.warn(`[WhatsApp] Could not clean lock files in ${sDir}:`, e.message);
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
    });

    this.client.on("authenticated", () => {
      (global as any).__latestQR = null; // Clear QR immediately on authentication
      console.log("[WhatsApp] Session authenticated successfully.");
    });

    this.client.on("auth_failure", (msg) => {
      console.error("[WhatsApp] Authentication failure:", msg);
    });

    this.client.on("message", async (msg) => {
      console.log(`[WhatsApp] Received message event: from=${msg.from}, body=${msg.body ? msg.body.substring(0, 60) : ""}, type=${msg.type}`);
      
      try {
        const isGroup = msg.from.endsWith("@g.us");
        const isIndividualChat = msg.from.endsWith("@c.us") || msg.from.endsWith("@lid");
        
        if (!isIndividualChat && !isGroup) {
          console.log(`[WhatsApp] Ignoring unknown message format from: ${msg.from}`);
          return;
        }

        if (isGroup) {
          let isMentioned = false;
          let isReplyToMe = false;

          try {
            const mentions = await msg.getMentions();
            isMentioned = mentions.some(contact => contact.isMe);

            if (msg.hasQuotedMsg) {
              const quoted = await msg.getQuotedMessage();
              if (quoted.fromMe) {
                isReplyToMe = true;
              }
            }
          } catch (e) {
            console.error("Error checking group mentions:", e);
          }

          if (!isMentioned && !isReplyToMe) {
            // Ignore normal group chatter
            return;
          }
          console.log(`[WhatsApp] Bot activated in group ${msg.from} via ${isMentioned ? 'mention' : 'reply'}`);
        }

        let text = msg.body;
        let isVoice = false;

        // Check if message is a voice note or audio file
        if (msg.type === "ptt" || msg.type === "audio") {
          if (msg.hasMedia) {
            isVoice = true;
            console.log(`[WhatsApp] Received voice message. Downloading...`);
            const media = await msg.downloadMedia();
            if (!media) {
              await msg.reply("⚠️ Received a voice message, but was unable to retrieve the audio data.");
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

        // The actual sender's phone number ID (msg.author exists for groups, msg.from for direct)
        const senderId = msg.author || msg.from;
        console.log(`[WhatsApp] Processing input for ${senderId}: "${text}"`);
        let contactName = "";
        try {
          const contact = await msg.getContact();
          contactName = contact.pushname || contact.name || "";
        } catch (err: any) {
          console.error("Failed to retrieve contact name:", err.message);
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

        let response = await handleIncomingMessage(senderId, text, contactName);
        
        if (chat) {
          try {
            await chat.clearState();
          } catch (e) {}
        }
        
        if (response) {
          let textToReply = response;
          if (isVoice) {
            textToReply = `🎤 _" ${text} "_\n\n${response}`;
          }
          
          // Send the text response first (with transcript context)
          await msg.reply(textToReply);

          // If the user messaged us via voice, we talk back to them!
          if (isVoice) {
            try {
              if (chat) {
                await chat.sendStateRecording();
              }
              console.log(`[WhatsApp] Generating voice message reply for ${msg.from}...`);
              const tempSpeechPath = path.join(os.tmpdir(), `speech-${Date.now()}.mp3`);
              
              // Clean response text from markdown symbols so it sounds natural
              const cleanText = response
                .replace(/[\*\_`#\-•]/g, "") // remove formatting marks
                .replace(/https?:\/\/\S+/g, "link") // replace urls with "link"
                .substring(0, 400); // limit speech content for low latency
              
              await generateSpeech(cleanText, tempSpeechPath);
              
              const media = MessageMedia.fromFilePath(tempSpeechPath);
              await this.client.sendMessage(msg.from, media, { sendAudioAsVoice: true });
              
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
        console.error(`[WhatsApp] Error processing message from ${msg.from}:`, error.message);
        try {
          await msg.reply("⚠️ Sorry, I encountered an internal error processing that request. Please try again.");
        } catch (replyErr: any) {
          console.error("Failed to send error reply:", replyErr.message);
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


  public async sendMessage(chatId: string, text: string): Promise<void> {
    await this.client.sendMessage(chatId, text);
  }

  public async getPairingCode(phoneNumber: string): Promise<string> {
    console.log(`[WhatsApp] Requesting pairing code for: ${phoneNumber}`);
    return await this.client.requestPairingCode(phoneNumber);
  }
}
