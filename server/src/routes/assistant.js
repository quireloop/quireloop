import fs from 'node:fs/promises';
import { requireAuth, requireProjectAccess } from '../lib/authMiddleware.js';
import { resolveProjectPath } from '../lib/storage.js';
import { getSettings } from '../lib/settings.js';
import { findUserById } from '../lib/auth.js';
import * as anthropicProvider from '../lib/assistantProviders/anthropic.js';
import * as ollamaProvider from '../lib/assistantProviders/ollama.js';

// The AI writing assistant is per-user and opt-in: each member brings their
// own Anthropic API key or points at an Ollama server from their own
// Account settings — never a single account shared/billed across the lab.
// An admin can still set a server-wide default (env var or Admin panel) as
// a fallback for members who haven't configured anything of their own —
// resolveAssistantConfig() below tries the user's own config first.
export const DEFAULT_ASSISTANT_MODEL = 'claude-opus-4-8';

const PROVIDERS = { anthropic: anthropicProvider, ollama: ollamaProvider };

async function resolveAssistantConfig(userId) {
  const user = await findUserById(userId);
  const ua = user?.assistant;
  if (ua?.provider === 'anthropic' && ua.anthropicApiKey) {
    return { provider: 'anthropic', anthropicApiKey: ua.anthropicApiKey, anthropicModel: ua.anthropicModel || DEFAULT_ASSISTANT_MODEL };
  }
  if (ua?.provider === 'ollama' && ua.ollamaBaseUrl && ua.ollamaModel) {
    return { provider: 'ollama', ollamaBaseUrl: ua.ollamaBaseUrl, ollamaModel: ua.ollamaModel };
  }

  // Fall back to a server-wide default the admin configured, if any.
  const settings = await getSettings();
  const envKey = process.env.QUIRELOOP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const adminAnthropicKey = envKey || settings.anthropicApiKey || '';
  if (adminAnthropicKey) {
    return {
      provider: 'anthropic',
      anthropicApiKey: adminAnthropicKey,
      anthropicModel: process.env.QUIRELOOP_ASSISTANT_MODEL || settings.assistantModel || DEFAULT_ASSISTANT_MODEL,
    };
  }
  const ollamaBaseUrl = process.env.QUIRELOOP_OLLAMA_BASE_URL || settings.ollamaBaseUrl || '';
  const ollamaModel = process.env.QUIRELOOP_OLLAMA_MODEL || settings.ollamaModel || '';
  if (ollamaBaseUrl && ollamaModel) {
    return { provider: 'ollama', ollamaBaseUrl, ollamaModel };
  }
  return null;
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
    const abs = resolveProjectPath(ownerId, projectId, filePath);
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
      model: config ? (config.provider === 'ollama' ? config.ollamaModel : config.anthropicModel) : null,
    };
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

    const { messages, file, selection } = req.body ?? {};
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
