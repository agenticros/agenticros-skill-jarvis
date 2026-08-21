/**
 * Direct OpenAI / Ollama chat with built-in see, scan_for, and follow_me tools.
 */

import type { JarvisConfig } from "../config.js";
import { openaiBaseUrl, resolveOpenAiKey } from "../keys.js";
import type { JarvisRuntime } from "../runtime.js";
import { describeScene, followMeHint, scanForObject } from "../robot-actions.js";
import { askOpenClaw } from "./openclaw.js";

const SYSTEM = `You are a robot voice assistant. Reply in one or two short spoken sentences.
No markdown, lists, URLs, or code. Use tools when the user asks what you see, to scan/find an object, or to follow them.`;

const FAST_SYSTEM = `You are a robot voice assistant. Reply in one or two short spoken sentences.
No markdown, lists, URLs, or code.

Answer general knowledge, time, jokes, and chit-chat yourself.
Call robot_agent when the user wants the robot to look, scan, follow, move, navigate, manipulate, dock, or use sensors — including short follow-ups to those actions (stop, wait, keep going).
Do not call robot_agent for trivia, definitions, or casual conversation.`;

type ChatProvider = "openai" | "ollama";

interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "see",
      description: "Look through the robot RealSense camera and describe the scene.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "scan_for",
      description: "Rotate in place and look for an object (e.g. cup, bottle, chair).",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Object to look for" },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "follow_me",
      description: "Start person-following. Requires the Follow Me skill when using OpenClaw.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

const ROBOT_AGENT_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "robot_agent",
      description:
        "Hand this request to the robot's AgenticROS agent. Use for camera, sensors, movement, following, scanning, maps, arms, docking, or any physical action. Do not use for trivia, time, jokes, or general conversation.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why this needs the robot agent" },
        },
        additionalProperties: false,
      },
    },
  },
];

export async function askDirectLlm(utterance: string, rt: JarvisRuntime, signal?: AbortSignal): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(rt.jarvis) },
    ...historyMessages(rt),
    { role: "user", content: utterance },
  ];
  const provider: ChatProvider = rt.jarvis.agentBackend === "ollama" ? "ollama" : "openai";
  for (let round = 0; round < 6; round++) {
    const reply = await chat(rt.jarvis, messages, signal, { provider, tools: TOOLS });
    if (!reply.tool_calls?.length) {
      return reply.content.trim();
    }
    messages.push(reply);
    for (const call of reply.tool_calls) {
      const result = await runTool(call, rt, signal);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return "I tried, but I did not finish that request.";
}

/**
 * Fast spoken chat for OpenClaw deployments. Answers trivia locally; robot
 * requests escalate to the full AgenticROS agent via robot_agent.
 */
export async function askFastChat(utterance: string, rt: JarvisRuntime, signal?: AbortSignal): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: fastSystemPrompt(rt.jarvis) },
    ...historyMessages(rt),
    { role: "user", content: utterance },
  ];
  const provider: ChatProvider = rt.jarvis.chatBackend === "ollama" ? "ollama" : "openai";
  for (let round = 0; round < 3; round++) {
    const reply = await chat(rt.jarvis, messages, signal, { provider, tools: ROBOT_AGENT_TOOLS });
    if (reply.tool_calls?.some((c) => c.name === "robot_agent")) {
      rt.logger.info("Jarvis route: robot (tool)");
      return askOpenClaw(utterance, rt.jarvis, rt.logger, signal);
    }
    const text = reply.content.trim();
    if (text) {
      rt.logger.info("Jarvis route: chat");
      return text;
    }
    if (!reply.tool_calls?.length) break;
    messages.push(reply);
    for (const call of reply.tool_calls) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: "Unknown tool. Call robot_agent for robot work, or answer the user.",
      });
    }
  }
  rt.logger.info("Jarvis route: robot (chat empty)");
  return askOpenClaw(utterance, rt.jarvis, rt.logger, signal);
}

function historyMessages(rt: JarvisRuntime): ChatMessage[] {
  return rt.chatHistory.map((m) => ({ role: m.role, content: m.content }));
}

function systemPrompt(jarvis: JarvisConfig): string {
  return `${SYSTEM}\nYour name is ${jarvis.name}. The operator is ${jarvis.operatorName}. ${jarvis.character} ${jarvis.persona}`;
}

function fastSystemPrompt(jarvis: JarvisConfig): string {
  return `${FAST_SYSTEM}\nYour name is ${jarvis.name}. The operator is ${jarvis.operatorName}. Current local time: ${new Date().toLocaleString()}.`;
}

async function runTool(call: ToolCall, rt: JarvisRuntime, signal?: AbortSignal): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  try {
    if (call.name === "see") return await describeScene(rt);
    if (call.name === "scan_for") {
      const target = String(args.target ?? "object");
      return await scanForObject(rt, target, signal);
    }
    if (call.name === "follow_me") return followMeHint();
    return `Unknown tool ${call.name}`;
  } catch (err) {
    return `Tool failed: ${String(err).slice(0, 200)}`;
  }
}

async function chat(
  jarvis: JarvisConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  opts: { provider: ChatProvider; tools: ChatTool[] },
): Promise<ChatMessage> {
  if (opts.provider === "ollama") return chatOllama(jarvis, messages, signal, opts.tools);
  return chatOpenAi(jarvis, messages, signal, opts.tools);
}

async function chatOpenAi(
  jarvis: JarvisConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  tools: ChatTool[],
): Promise<ChatMessage> {
  const key = resolveOpenAiKey(jarvis);
  if (!key) throw new Error("No OpenAI API key for chat");
  const res = await fetch(`${openaiBaseUrl(jarvis)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: jarvis.openaiModel || "gpt-4o-mini",
      messages: toOpenAiMessages(messages),
      ...(tools.length ? { tools } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI chat ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
  };
  const msg = data.choices?.[0]?.message;
  const tool_calls = (msg?.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c) => ({
      id: c.id,
      name: c.function!.name!,
      arguments: c.function?.arguments ?? "{}",
    }));
  return { role: "assistant", content: msg?.content ?? "", tool_calls: tool_calls.length ? tool_calls : undefined };
}

async function chatOllama(
  jarvis: JarvisConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  tools: ChatTool[],
): Promise<ChatMessage> {
  const res = await fetch(`${jarvis.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: jarvis.ollamaModel,
      stream: false,
      messages: toOpenAiMessages(messages),
      ...(tools.length ? { tools } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama chat ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    message?: {
      content?: string;
      tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
    };
  };
  const msg = data.message;
  const tool_calls = (msg?.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: `call_${i}`,
      name: c.function!.name!,
      arguments:
        typeof c.function?.arguments === "string"
          ? c.function.arguments
          : JSON.stringify(c.function?.arguments ?? {}),
    }));
  return { role: "assistant", content: msg?.content ?? "", tool_calls: tool_calls.length ? tool_calls : undefined };
}

function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}
