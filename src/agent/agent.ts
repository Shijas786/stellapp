import OpenAI from "openai";
import { SYSTEM_PROMPT, OPENAI_TOOLS } from "./prompt";
import { executeTool, UserWalletData } from "./tools";
import { config } from "../services/config";
import { prisma } from "../services/db";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set in the environment variables.");
}

const openai = new OpenAI({ apiKey });

// Helper to save history to DB with pruning
async function saveHistory(chatId: string, history: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<void> {
  if (history.length > 25) {
    const systemPrompt = history[0];
    let sliceIndex = history.length - 20;
    while (sliceIndex < history.length && history[sliceIndex].role !== "user") {
      sliceIndex++;
    }
    if (sliceIndex === history.length) {
      sliceIndex = history.length - 20;
    }
    history = [systemPrompt, ...history.slice(sliceIndex)];
  }

  try {
    await prisma.chatHistory.upsert({
      where: { chatId },
      create: { chatId, messages: JSON.stringify(history) },
      update: { messages: JSON.stringify(history) }
    });
  } catch (err: any) {
    console.error(`[Agent] Failed to save chat history to database:`, err.message);
  }
}

/**
 * Injects a silent context note into the AI's history for a given chatId.
 * Used by non-AI flows (e.g. vCard saves) so the AI remembers recent events
 * when the user's next message arrives.
 */
export async function injectContextMessage(chatId: string, assistantNote: string): Promise<void> {
  try {
    const record = await prisma.chatHistory.findUnique({ where: { chatId } });
    if (record) {
      const history = JSON.parse(record.messages);
      history.push({ role: "assistant", content: assistantNote });
      await saveHistory(chatId, history);
      console.log(`[Agent] Injected context for ${chatId}: ${assistantNote.substring(0, 80)}`);
    }
  } catch (err: any) {
    console.error(`[Agent] Failed to inject context message:`, err.message);
  }
}

type ActiveSkill = {
  skillName: string;
  content: string;
  calledAt: number;
};

// In-memory cache of active skills (TTL 60 mins, max 3 per chat)
// Note: Single-instance in-memory cache. Re-deploying will wipe pinned contexts.
const activeSkillCache = new Map<string, ActiveSkill[]>();

// Prevent concurrent modifications to history array while a long-running tool is active
const activeLocks = new Set<string>();

/**
 * Main AI agent runtime loop using OpenAI models with tool calling capabilities.
 */
export async function runAgentLoop(
  chatId: string,
  userMessage: string,
  user: UserWalletData
): Promise<string> {
  if (activeLocks.has(chatId)) {
    return "⏳ Please wait, I am still processing your previous request. Building custom contracts can take up to 60 seconds!";
  }
  
  activeLocks.add(chatId);
  try {
    // 1. Load history from DB
    let history: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    try {
      const record = await prisma.chatHistory.findUnique({ where: { chatId } });
      if (record) {
        history = JSON.parse(record.messages);
      }
    } catch (dbErr: any) {
      console.error(`[Agent] Failed to load history from DB:`, dbErr.message);
    }

    const formattedSystemPrompt = SYSTEM_PROMPT
      .replace("{{stellarPublic}}", user.stellarPublic);

    if (history.length === 0) {
      history = [
        { role: "system", content: formattedSystemPrompt }
      ];
    } else {
      history[0].content = formattedSystemPrompt;
    }

    // 2. Add new user query
    history.push({ role: "user", content: userMessage });
    await saveHistory(chatId, history);

    // 3. Prepare dynamic system prompt with active skills
    const baseSystemMessage = history[0];
    let dynamicSystemContent = baseSystemMessage.content as string;

    let activeSkills = activeSkillCache.get(chatId) || [];
    const now = Date.now();
    activeSkills = activeSkills.filter(s => now - s.calledAt < 60 * 60 * 1000);
    
    if (activeSkills.length > 0) {
      activeSkillCache.set(chatId, activeSkills);
      const pinnedText = activeSkills.map(s => `[PINNED SKILL: ${s.skillName}]\n${s.content}`).join("\n\n---\n\n");
      dynamicSystemContent += `\n\n=== ACTIVE SKILLS CONTEXT ===\n${pinnedText}`;
    } else {
      activeSkillCache.delete(chatId);
    }

    const messagesForOpenAI: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: dynamicSystemContent },
      ...history.slice(1)
    ];

    // 4. Request completion from OpenAI
    let response = await openai.chat.completions.create({
      model: config.openaiModel,
      messages: messagesForOpenAI,
      tools: OPENAI_TOOLS
    });

    let assistantMessage = response.choices[0].message;
    history.push(assistantMessage);
    await saveHistory(chatId, history);

    // Allow up to 5 sequential tool calling rounds (for multi-step agent actions)
    for (let round = 0; round < 5; round++) {
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        break;
      }

      console.log(`[Agent Loop] OpenAI requested ${assistantMessage.tool_calls.length} tool call(s)`);

      for (const toolCall of assistantMessage.tool_calls) {
        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`[Agent Loop] Executing tool: ${name} with args:`, args);
        
        try {
          if (name === "compile_custom_contract") {
            const contractType = (args.contractType || "custom").toLowerCase();
            if (contractType === "custom") {
              const currentSkills = activeSkillCache.get(chatId) || [];
              if (!currentSkills.some(s => s.skillName === "smart-contracts" || s.skillName.startsWith("oz-"))) {
                throw new Error("SECURITY BLOCK: You attempted to compile a custom contract without reading the syntax rules. You MUST call read_skill with 'smart-contracts' or an 'oz-' skill first to load the correct Soroban syntax and OpenZeppelin patterns into your context window. Do not guess the Rust code.");
              }
            }
          }

          const toolResult = await executeTool(chatId, name, args, user);
          
          if (name === "read_skill" && typeof toolResult === "string" && !toolResult.startsWith("Error:") && !toolResult.includes("not found")) {
            const skillName = args.skillName;
            const currentSkills = activeSkillCache.get(chatId) || [];
            const filteredSkills = currentSkills.filter(s => s.skillName !== skillName);
            filteredSkills.unshift({ skillName, content: toolResult, calledAt: Date.now() });
            activeSkillCache.set(chatId, filteredSkills.slice(0, 3));
          }

          history.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ result: toolResult })
          });
        } catch (error: any) {
          console.error(`[Agent Loop] Tool execution failed for ${name}:`, error.message);
          history.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error.message || "Action failed." })
          });
        }
      }

      await saveHistory(chatId, history);

      activeSkills = activeSkillCache.get(chatId) || [];
      if (activeSkills.length > 0) {
        const pinnedText = activeSkills.map(s => `[PINNED SKILL: ${s.skillName}]\n${s.content}`).join("\n\n---\n\n");
        dynamicSystemContent = (baseSystemMessage.content as string) + `\n\n=== ACTIVE SKILLS CONTEXT ===\n${pinnedText}`;
      }

      const updatedMessagesForOpenAI: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: dynamicSystemContent },
        ...history.slice(1)
      ];

      response = await openai.chat.completions.create({
        model: config.openaiModel,
        messages: updatedMessagesForOpenAI,
        tools: OPENAI_TOOLS
      });

      assistantMessage = response.choices[0].message;
      history.push(assistantMessage);
      await saveHistory(chatId, history);
    }

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      history.pop();
      assistantMessage = {
        role: "assistant",
        content: "⚠️ I reached my internal processing limit trying to fulfill your request. Please try again or break the task into smaller steps.",
        refusal: null
      };
      history.push(assistantMessage);
      await saveHistory(chatId, history);
    }

    return assistantMessage.content || "I have processed your request.";
  } finally {
    activeLocks.delete(chatId);
  }
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
