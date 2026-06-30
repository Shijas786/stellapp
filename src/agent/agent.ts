import OpenAI from "openai";
import { SYSTEM_PROMPT, OPENAI_TOOLS } from "./prompt";
import { executeTool, UserWalletData } from "./tools";
import { config } from "../services/config";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set in the environment variables.");
}

const openai = new OpenAI({ apiKey });

// In-memory cache of user chat histories to preserve conversation context
const chatHistories = new Map<string, OpenAI.Chat.ChatCompletionMessageParam[]>();

/**
 * Main AI agent runtime loop using OpenAI GPT-4o with tool calling capabilities.
 */
export async function runAgentLoop(
  chatId: string,
  userMessage: string,
  user: UserWalletData
): Promise<string> {
  let history = chatHistories.get(chatId);

  // 1. Initialize history with formatted system prompt if first message
  if (!history) {
    const formattedSystemPrompt = SYSTEM_PROMPT
      .replace("{{stellarPublic}}", user.stellarPublic)
      .replace("{{evmAddress}}", user.evmAddress);

    history = [
      { role: "system", content: formattedSystemPrompt }
    ];
    chatHistories.set(chatId, history);
  }

  // 2. Add new user query
  history.push({ role: "user", content: userMessage });

  // 3. Request completion from OpenAI
  let response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: history,
    tools: OPENAI_TOOLS
  });

  let assistantMessage = response.choices[0].message;
  history.push(assistantMessage);

  // Allow up to 3 sequential tool calling rounds (for multi-step agent actions)
  for (let round = 0; round < 3; round++) {
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break; // No tools to call
    }

    console.log(`[Agent Loop] OpenAI requested ${assistantMessage.tool_calls.length} tool call(s)`);

    // Execute tool calls in parallel (OpenAI native feature)
    for (const toolCall of assistantMessage.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);

      console.log(`[Agent Loop] Executing tool: ${name} with args:`, args);
      
      try {
        const toolResult = await executeTool(chatId, name, args, user);
        
        history.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ result: toolResult })
        });
      } catch (error: any) {
        console.error(`[Agent Loop] Tool execution failed for ${name}:`, error.message);
        
        // Feed the error output back to OpenAI
        history.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: error.message || "Action failed." })
        });
      }
    }

    // Call OpenAI again with the tool results added to the message log
    response = await openai.chat.completions.create({
      model: config.openaiModel,
      messages: history,
      tools: OPENAI_TOOLS
    });

    assistantMessage = response.choices[0].message;
    history.push(assistantMessage);
  }

  // 4. Memory Optimization: keep history at a manageable size (last 20 messages)
  if (history.length > 25) {
    const systemPrompt = history[0];
    const recentHistory = history.slice(-20);
    chatHistories.set(chatId, [systemPrompt, ...recentHistory]);
  }

  // Return the final text message
  return assistantMessage.content || "I have processed your request.";
}

/**
 * Transcribes an audio file (e.g. OGG/MP3) using OpenAI's Whisper API.
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  console.log(`[Whisper] Sending ${filePath} for transcription...`);
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
    language: "en",
    prompt: "This audio is in English. Please transcribe it clearly."
  });
  console.log(`[Whisper] Transcript: "${response.text}"`);
  return response.text;
}

/**
 * Generates an audio file from text using OpenAI's Text-to-Speech (TTS) API.
 */
export async function generateSpeech(text: string, filePath: string): Promise<void> {
  console.log(`[TTS] Generating speech for text: "${text.substring(0, 30)}..."`);
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: text,
    response_format: "mp3"
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  console.log(`[TTS] Saved audio file to: ${filePath}`);
}
