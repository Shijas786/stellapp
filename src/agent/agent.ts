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

// In-memory cache of user chat histories to preserve conversation context
const chatHistories = new Map<string, OpenAI.Chat.ChatCompletionMessageParam[]>();

type ActiveSkill = {
  skillName: string;
  content: string;
  calledAt: number;
};

// In-memory cache of active skills (TTL 60 mins, max 3 per chat)
// Note: Single-instance in-memory cache. Re-deploying will wipe pinned contexts.
const activeSkillCache = new Map<string, ActiveSkill[]>();

/**
 * Main AI agent runtime loop using OpenAI GPT-4o with tool calling capabilities.
 */
export async function runAgentLoop(
  chatId: string,
  userMessage: string,
  user: UserWalletData
): Promise<string> {
  let history = chatHistories.get(chatId);

  // Fetch saved contacts for this user dynamically on every turn
  const contacts = await prisma.contact.findMany({ where: { ownerId: user.id } });
  const contactsList = contacts.length > 0 
    ? contacts.map(c => `- ${c.name}: ${c.phoneNumber}`).join("\n") 
    : "No saved contacts yet.";

  // 1. Initialize or update history with formatted system prompt
  const formattedSystemPrompt = SYSTEM_PROMPT
    .replace("{{stellarPublic}}", user.stellarPublic)
    .replace("{{evmAddress}}", user.evmAddress)
    .replace("{{savedContacts}}", contactsList);

  if (!history) {
    history = [
      { role: "system", content: formattedSystemPrompt }
    ];
    chatHistories.set(chatId, history);
  } else {
    // Overwrite the first message (system prompt) to ensure freshness of contacts
    history[0].content = formattedSystemPrompt;
  }

  // 2. Add new user query
  history.push({ role: "user", content: userMessage });

  // 3. Prepare dynamic system prompt with active skills
  const baseSystemMessage = history[0];
  let dynamicSystemContent = baseSystemMessage.content as string;

  let activeSkills = activeSkillCache.get(chatId) || [];
  const now = Date.now();
  // Evict skills older than 60 minutes
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

  // Allow up to 5 sequential tool calling rounds (for multi-step agent actions)
  for (let round = 0; round < 5; round++) {
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
        if (name === "deploy_custom_contract") {
          const contractType = (args.contractType || "custom").toLowerCase();
          if (contractType === "custom") {
            const currentSkills = activeSkillCache.get(chatId) || [];
            if (!currentSkills.some(s => s.skillName === "smart-contracts" || s.skillName.startsWith("oz-"))) {
              throw new Error("SECURITY BLOCK: You attempted to deploy a custom contract without reading the syntax rules. You MUST call read_skill with 'smart-contracts' or an 'oz-' skill first to load the correct Soroban syntax and OpenZeppelin patterns into your context window. Do not guess the Rust code.");
            }
          }
        }

        const toolResult = await executeTool(chatId, name, args, user);
        
        // Intercept read_skill to cache it permanently for this session
        if (name === "read_skill" && typeof toolResult === "string" && !toolResult.startsWith("Error:") && !toolResult.includes("not found")) {
          const skillName = args.skillName;
          const currentSkills = activeSkillCache.get(chatId) || [];
          const filteredSkills = currentSkills.filter(s => s.skillName !== skillName);
          // Prepend new skill, cap array at 3 items
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
        
        // Feed the error output back to OpenAI
        history.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: error.message || "Action failed." })
        });
      }
    }

    // Re-evaluate active skills (in case one was just added)
    activeSkills = activeSkillCache.get(chatId) || [];
    if (activeSkills.length > 0) {
      const pinnedText = activeSkills.map(s => `[PINNED SKILL: ${s.skillName}]\n${s.content}`).join("\n\n---\n\n");
      dynamicSystemContent = (baseSystemMessage.content as string) + `\n\n=== ACTIVE SKILLS CONTEXT ===\n${pinnedText}`;
    }

    const updatedMessagesForOpenAI: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: dynamicSystemContent },
      ...history.slice(1)
    ];

    // Call OpenAI again with the tool results added to the message log
    response = await openai.chat.completions.create({
      model: config.openaiModel,
      messages: updatedMessagesForOpenAI,
      tools: OPENAI_TOOLS
    });

    assistantMessage = response.choices[0].message;
    history.push(assistantMessage);
  }

  // If the loop exited but the last message is a tool call, we must remove it from history
  // because we didn't execute the tools, rendering the history invalid for future turns.
  if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    history.pop();
    assistantMessage = {
      role: "assistant",
      content: "⚠️ I reached my internal processing limit trying to fulfill your request. Please try again or break the task into smaller steps.",
      refusal: null
    };
    history.push(assistantMessage);
  }

  // 4. Memory Optimization: keep history at a manageable size (last 20 messages)
  if (history.length > 25) {
    const systemPrompt = history[0];
    let sliceIndex = history.length - 20;
    
    // Find the nearest user message to start the slice safely
    // This prevents slicing an assistant tool_calls message while keeping its orphaned tool responses
    while (sliceIndex < history.length && history[sliceIndex].role !== "user") {
      sliceIndex++;
    }
    
    // Fallback if we couldn't find a user message
    if (sliceIndex === history.length) {
      sliceIndex = history.length - 20;
    }

    const recentHistory = history.slice(sliceIndex);
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
