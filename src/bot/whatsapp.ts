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
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--renderer-process-limit=2"
        ],
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.client.on("qr", (qr) => {
      // Store QR globally so the HTTP endpoint in index.ts can serve it as a scannable image
      (global as any).__latestQR = qr;
      // Also log raw QR string to Railway console as fallback
      console.log("\n[WhatsApp] New QR code generated. Visit your Railway URL to scan it.");
      console.log("[WhatsApp] Raw QR (for local debug):", qr.substring(0, 40) + "...");
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
    this.client.initialize().catch((err) => {
      console.error("[WhatsApp] Failed to initialize client:", err.message);
    });
  }

  public async sendMessage(chatId: string, text: string): Promise<void> {
    await this.client.sendMessage(chatId, text);
  }

  public async getPairingCode(phoneNumber: string): Promise<string> {
    console.log(`[WhatsApp] Requesting pairing code for: ${phoneNumber}`);
    return await this.client.requestPairingCode(phoneNumber);
  }
}
