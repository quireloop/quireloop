import { friendlyStatus, ProviderError, readSse } from './sse.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// The key goes in a header, never the URL, so it can't end up in a log line.
const authHeaders = (config) => ({ 'x-goog-api-key': config.geminiApiKey });

export async function listModels(config) {
  const res = await fetch(`${BASE_URL}/models?pageSize=200`, {
    headers: authHeaders(config),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new ProviderError(res.status);
  const body = await res.json();
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((id) => id.startsWith('gemini'))
    .sort()
    .reverse();
}

export async function streamChat({ config, system, messages, maxTokens, onDelta, signal }) {
  const url = `${BASE_URL}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new ProviderError(res.status);

  const final = { stopReason: 'stop', usage: { input: 0, output: 0 } };
  await readSse(res, (chunk) => {
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) onDelta(part.text);
    }
    if (candidate?.finishReason) final.stopReason = candidate.finishReason;
    if (chunk.usageMetadata) {
      final.usage = {
        input: chunk.usageMetadata.promptTokenCount || 0,
        output: chunk.usageMetadata.candidatesTokenCount || 0,
      };
    }
  });
  return final;
}

export function friendlyError(err) {
  return friendlyStatus(err, 'Gemini');
}
