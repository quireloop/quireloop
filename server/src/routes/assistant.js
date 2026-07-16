import fs from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { requireProjectAccess } from '../lib/authMiddleware.js';
import { resolveProjectPath } from '../lib/storage.js';
import { getSettings } from '../lib/settings.js';

// The AI writing assistant is opt-in: it only exists when an Anthropic API
// key is provided — either pasted by the admin in the Admin panel (stored
// in data/settings.json) or via environment variable. Without one, the
// endpoint 503s and the frontend hides the panel entirely — Quireloop
// stays fully functional (and fully offline) without it.
//
// Resolved per-request, not at boot, so a key saved in the Admin panel
// takes effect immediately with no restart. Env var wins over the stored
// setting so ops-managed deployments stay deterministic.
export const DEFAULT_ASSISTANT_MODEL = 'claude-opus-4-8';

async function assistantConfig() {
  const settings = await getSettings();
  return {
    apiKey:
      process.env.QUIRELOOP_ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      settings.anthropicApiKey ||
      '',
    model: process.env.QUIRELOOP_ASSISTANT_MODEL || settings.assistantModel || DEFAULT_ASSISTANT_MODEL,
  };
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
  // Lets the frontend decide whether to render the Assistant button at all.
  app.get('/api/assistant/config', async () => {
    const { apiKey, model } = await assistantConfig();
    return { enabled: Boolean(apiKey), model: apiKey ? model : null };
  });

  // Viewers can use the assistant too — asking questions about a paper
  // doesn't touch the document (inserting the answer does, and the editor
  // is read-only for them anyway).
  app.post('/api/projects/:id/assistant', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { apiKey, model } = await assistantConfig();
    if (!apiKey) {
      return reply.code(503).send({ error: 'assistant not configured on this server' });
    }

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
    // stays byte-stable so prompt caching holds across every request from
    // every user on the server.
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

    const client = new Anthropic({ apiKey });
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: apiMessages,
      });
      // Abort the upstream request if the browser goes away mid-stream.
      req.raw.on('close', () => stream.abort());

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          send('text', { text: event.delta.text });
        }
      }
      const final = await stream.finalMessage();
      send('done', {
        stopReason: final.stop_reason,
        usage: { input: final.usage.input_tokens, output: final.usage.output_tokens },
      });
    } catch (err) {
      // AbortError just means the client closed the panel — nothing to report.
      if (err?.name !== 'AbortError' && !reply.raw.writableEnded) {
        app.log.error({ err }, 'assistant request failed');
        send('error', { message: friendlyAssistantError(err) });
      }
    } finally {
      reply.raw.end();
    }
  });
}

function friendlyAssistantError(err) {
  const status = err?.status;
  if (status === 401) return 'the server’s Anthropic API key was rejected — ask your admin to check it';
  if (status === 429) return 'the assistant is rate-limited right now — try again in a moment';
  if (status >= 500) return 'the Claude API is having trouble — try again shortly';
  return 'assistant request failed — try again';
}
