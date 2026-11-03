import fs from 'node:fs/promises';
import { requireAuth, requireProjectAccess } from '../lib/authMiddleware.js';
import { resolveUserPath } from '../lib/storage.js';
import { getSettings } from '../lib/settings.js';
import { findUserById } from '../lib/auth.js';
import * as anthropicProvider from '../lib/assistantProviders/anthropic.js';
import * as ollamaProvider from '../lib/assistantProviders/ollama.js';
import * as openaiProvider from '../lib/assistantProviders/openai.js';
import * as geminiProvider from '../lib/assistantProviders/gemini.js';

// The AI writing assistant is per-user and opt-in: each member brings their
// own API key or points at an Ollama server from their own
// Account settings — never a single account shared/billed across the lab.
// An admin can still set a server-wide default (env var or Admin panel) as
// a fallback for members who haven't configured anything of their own —
// resolveAssistantConfig() below tries the user's own config first.
export const DEFAULT_ASSISTANT_MODEL = 'claude-opus-4-8';

const PROVIDERS = {
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function isValidModelId(id) {
  return typeof id === 'string' && id.length <= 200 && /^[\w.:/-]+$/.test(id);
}

function fromUser(ua) {
  if (ua?.provider === 'anthropic' && ua.anthropicApiKey) {
    return { provider: 'anthropic', anthropicApiKey: ua.anthropicApiKey, model: ua.anthropicModel || DEFAULT_ASSISTANT_MODEL };
  }
  if (ua?.provider === 'ollama' && ua.ollamaBaseUrl) {
    return { provider: 'ollama', ollamaBaseUrl: ua.ollamaBaseUrl, model: ua.ollamaModel || '' };
  }
  if (ua?.provider === 'openai' && ua.openaiApiKey) {
    return { provider: 'openai', openaiApiKey: ua.openaiApiKey, model: ua.openaiModel || '' };
  }
  if (ua?.provider === 'gemini' && ua.geminiApiKey) {
    return { provider: 'gemini', geminiApiKey: ua.geminiApiKey, model: ua.geminiModel || '' };
  }
  return null;
}

async function resolveAssistantConfig(userId) {
  const user = await findUserById(userId);
  const own = fromUser(user?.assistant);
  if (own) return own;

  // Fall back to a server-wide default the admin configured, if any.
  const settings = await getSettings();
  const envKey = process.env.QUIRELOOP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const adminAnthropicKey = envKey || settings.anthropicApiKey || '';
  if (adminAnthropicKey) {
    return {
      provider: 'anthropic',
      anthropicApiKey: adminAnthropicKey,
      model: process.env.QUIRELOOP_ASSISTANT_MODEL || settings.assistantModel || DEFAULT_ASSISTANT_MODEL,
    };
  }
  const ollamaBaseUrl = process.env.QUIRELOOP_OLLAMA_BASE_URL || settings.ollamaBaseUrl || '';
  if (ollamaBaseUrl) {
    return { provider: 'ollama', ollamaBaseUrl, model: process.env.QUIRELOOP_OLLAMA_MODEL || settings.ollamaModel || '' };
  }
  return null;
}

// What this person can pick from, read live so a newly installed model simply
// appears. An unreachable provider isn't an error here: the panel still shows
// the saved model, and the real reason surfaces when they ask something.
async function listModels(config) {
  let models = [];
  try {
    models = await PROVIDERS[config.provider].listModels(config);
  } catch {
    // fall through to whatever was saved
  }
  if (config.model && !models.includes(config.model)) models = [config.model, ...models];
  return models;
}

// Deliberate cost cap for a chat panel — long enough for a rewritten
// section or a full derivation, short enough that one runaway question
// can't burn a lab's budget.
const MAX_TOKENS = 16000;
const MAX_CONTEXT_CHARS = 60_000; // ~15K tokens of file context per request
const MAX_HISTORY_MESSAGES = 30;

const SYSTEM_PROMPT = `You are the writing assistant built into Quireloop, a collaborative LaTeX editor used by researchers.

You help with academic papers: drafting and rewriting passages, fixing LaTeX errors, suggesting structure, tightening prose, math notation, BibTeX entries, tables, figures, and journal/conference formatting.

Rules:
- When you produce LaTeX the user might paste into their document, put it in a \`\`\`latex code block, complete and compilable in context — the editor offers one-click insert for code blocks.
- Match the document's existing conventions (macros, citation style, notation) visible in the provided file.
- Be direct and concise; researchers are reading this in a small side panel. Prefer a short answer plus a code block over long explanations.
- Never fabricate citations. If asked for references you cannot verify, say so and give a placeholder \\cite key the user must fill in.
- You see the file as it is on disk right now; collaborators may be editing live.`;


async function readFileContext(ownerId, projectId, filePath) {
  if (!filePath) return null;
  try {
    const abs = await resolveUserPath(ownerId, projectId, filePath);
    const content = await fs.readFile(abs, 'utf8');
    return content.length > MAX_CONTEXT_CHARS
      ? `${content.slice(0, MAX_CONTEXT_CHARS)}\n%% [truncated — file continues]`
      : content;
  } catch {
    return null;
  }
}

export default async function assistantRoutes(app) {
  // Lets the frontend decide whether to render the Assistant button at all,
  // resolved per the *current logged-in user*, not server-wide.
  app.get('/api/assistant/config', { preHandler: requireAuth }, async (req) => {
    const config = await resolveAssistantConfig(req.userId);
    return {
      enabled: Boolean(config),
      provider: config?.provider ?? null,
      model: config?.model || null,
    };
  });

  app.get('/api/assistant/models', { preHandler: requireAuth }, async (req) => {
    const config = await resolveAssistantConfig(req.userId);
    if (!config) return { provider: null, model: null, models: [] };
    const models = await listModels(config);
    return { provider: config.provider, model: config.model || models[0] || null, models };
  });

  // Fills the model list in Account settings before anything is saved.
  app.post('/api/assistant/ollama-models', { preHandler: requireAuth }, async (req, reply) => {
    const settings = await getSettings();
    const baseUrl = req.body?.baseUrl || process.env.QUIRELOOP_OLLAMA_BASE_URL || settings.ollamaBaseUrl || '';
    try {
      if (!/^https?:$/.test(new URL(baseUrl).protocol)) throw new Error('bad scheme');
    } catch {
      return reply.code(400).send({ error: 'enter the address of an Ollama server' });
    }
    try {
      return { models: await ollamaProvider.listModels({ ollamaBaseUrl: baseUrl }) };
    } catch {
      return reply.code(502).send({ error: `no Ollama server answered at ${baseUrl}` });
    }
  });

  // Viewers can use the assistant too — asking questions about a paper
  // doesn't touch the document (inserting the answer does, and the editor
  // is read-only for them anyway).
  app.post('/api/projects/:id/assistant', { preHandler: requireProjectAccess }, async (req, reply) => {
    const config = await resolveAssistantConfig(req.userId);
    if (!config) {
      return reply.code(503).send({ error: 'no AI assistant configured — set one up in your account settings' });
    }
    const provider = PROVIDERS[config.provider];

    const { messages, file, selection, model } = req.body ?? {};
    if (model !== undefined && !isValidModelId(model)) {
      return reply.code(400).send({ error: 'invalid model id' });
    }
    // The dropdown in the panel, then the saved choice, then the first available.
    config.model = model || config.model || (await listModels(config))[0];
    if (!config.model) {
      return reply.code(503).send({ error: 'no model is available — choose one in your account settings' });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'messages required' });
    }
    const history = messages
      .slice(-MAX_HISTORY_MESSAGES)
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      return reply.code(400).send({ error: 'last message must be from the user' });
    }

    // Context (file list, open file, selection) is injected into the FIRST
    // user turn of this request, not the system prompt — the system prompt
    // stays byte-stable so prompt caching holds (Anthropic provider only)
    // across every request from every user on the server.
    const fileList = (req.manifest.files ?? []).map((f) => f.path).join('\n');
    const fileContent = await readFileContext(req.ownerId, req.params.id, file);
    let context = `<project name=${JSON.stringify(req.manifest.name ?? '')}>\nFiles:\n${fileList}\n</project>`;
    if (fileContent !== null) {
      context += `\n<open_file path=${JSON.stringify(file)}>\n${fileContent}\n</open_file>`;
    }
    if (typeof selection === 'string' && selection.trim()) {
      context += `\n<user_selection>\n${selection.slice(0, 10_000)}\n</user_selection>`;
    }

    const apiMessages = history.map((m, i) => ({
      role: m.role,
      content:
        i === history.length - 1
          ? `<context>\n${context}\n</context>\n\n${m.content}`
          : m.content,
    }));

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Shared across providers: Anthropic's SDK stream and Ollama's fetch
    // both honor this signal to abort the upstream request if the browser
    // goes away mid-stream.
    const controller = new AbortController();
    req.raw.on('close', () => controller.abort());

    try {
      const final = await provider.streamChat({
        config,
        system: SYSTEM_PROMPT,
        messages: apiMessages,
        maxTokens: MAX_TOKENS,
        onDelta: (text) => send('text', { text }),
        signal: controller.signal,
      });
      send('done', final);
    } catch (err) {
      if (!reply.raw.writableEnded) {
        const message = provider.friendlyError(err, config);
        if (message) {
          app.log.error({ err }, 'assistant request failed');
          send('error', { message });
        }
      }
    } finally {
      reply.raw.end();
    }
  });
}
