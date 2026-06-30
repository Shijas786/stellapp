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
          "--disable-gpu"
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

      const lockPaths = [
        path.join(authDir, "session/SingletonLock"),
        path.join(authDir, "session/Default/SingletonLock")
      ];
      
      for (const lockPath of lockPaths) {
        if (fs.existsSync(lockPath)) {
          console.log(`[WhatsApp] Stale lock file found: ${lockPath}. Removing it...`);
          fs.unlinkSync(lockPath);
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
      // Avoid responding to group messages or status updates
      if (msg.from.endsWith("@c.us")) {
        try {
          let text = msg.body;
          let isVoice = false;

          // Check if message is a voice note or audio file
          if (msg.type === "ptt" || msg.type === "audio") {
            if (msg.hasMedia) {
              isVoice = true;
              console.log(`[WhatsApp] Received voice message from ${msg.from}. Downloading...`);
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

          console.log(`[WhatsApp] Processing input for ${msg.from}: "${text}"`);
          let contactName = "";
          try {
            const contact = await msg.getContact();
            contactName = contact.pushname || contact.name || "";
          } catch (err: any) {
            console.error("Failed to retrieve contact name:", err.message);
          }

          let response = await handleIncomingMessage(msg.from, text, contactName);
          
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
              } catch (ttsError: any) {
                console.error("[WhatsApp] Failed to generate and send voice note response:", ttsError.message);
              }
            }
          }
        } catch (error: any) {
          console.error(`[WhatsApp] Error processing message from ${msg.from}:`, error.message);
          await msg.reply("⚠️ Sorry, I encountered an internal error processing that request. Please try again.");
        }
      }
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

    // Watchdog to attach console log listeners to the page for deep debugging
    const bindInterval = setInterval(() => {
      if (this.client.pupPage) {
        clearInterval(bindInterval);
        console.log("[WhatsApp] Browser page detected. Binding console debug listeners...");
        try {
          const page = this.client.pupPage;
          page.on("console", (msg) => {
            const txt = msg.text();
            // Filter out verbose debug info, log errors and alerts
            if (msg.type() === "error" || txt.includes("failed") || txt.includes("Error") || txt.includes("warning")) {
              console.log(`[Browser Console ${msg.type().toUpperCase()}] ${txt}`);
            }
          });
          page.on("pageerror", (err: any) => {
            console.error("[Browser Page Exception]", err.message);
          });
        } catch (e: any) {
          console.error("[WhatsApp] Error setting up console monitors:", e.message);
        }
      }
    }, 100);
  }

  public async sendMessage(chatId: string, text: string): Promise<void> {
    await this.client.sendMessage(chatId, text);
  }

  public async getPairingCode(phoneNumber: string): Promise<string> {
    console.log(`[WhatsApp] Requesting pairing code for: ${phoneNumber}`);
    return await this.client.requestPairingCode(phoneNumber);
  }
}
