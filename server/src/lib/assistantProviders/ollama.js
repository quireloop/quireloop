// Ollama has no prompt-caching concept, so the system prompt just goes in
// as a normal leading message. Uses Ollama's native /api/chat endpoint
// (newline-delimited JSON, one object per line) rather than an
// OpenAI-compatibility shim — no extra dependency needed, just fetch.
class OllamaError extends Error {
  constructor(status, body) {
    super(`ollama request failed: ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function streamChat({ config, system, messages, maxTokens, onDelta, signal }) {
  const baseUrl = config.ollamaBaseUrl.replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
      options: { num_predict: maxTokens },
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new OllamaError(res.status, body);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final = { stopReason: 'stop', usage: { input: 0, output: 0 } };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const chunk = JSON.parse(line);
      if (chunk.message?.content) onDelta(chunk.message.content);
      if (chunk.done) {
        final = {
          stopReason: chunk.done_reason || 'stop',
          usage: { input: chunk.prompt_eval_count || 0, output: chunk.eval_count || 0 },
        };
      }
    }
  }
  return final;
}

export function friendlyError(err, config) {
  if (err?.name === 'AbortError') return null;
  const code = err?.cause?.code || err?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return `can't reach Ollama at ${config?.ollamaBaseUrl || 'the configured address'} — is it running?`;
  }
  if (err instanceof OllamaError) {
    if (err.status === 404) {
      return `model "${config?.ollamaModel}" isn't pulled on that Ollama server — run "ollama pull ${config?.ollamaModel}" on the host`;
    }
    return `Ollama returned an error (${err.status})`;
  }
  return 'assistant request failed — try again';
}
