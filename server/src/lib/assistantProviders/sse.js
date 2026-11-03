// Reads a text/event-stream response, calling onData with each parsed `data:`
// payload. OpenAI and Gemini both stream this way.
export async function readSse(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data && data !== '[DONE]') onData(JSON.parse(data));
    }
  }
}

export class ProviderError extends Error {
  constructor(status) {
    super(`provider request failed: ${status}`);
    this.status = status;
  }
}

export function friendlyStatus(err, name) {
  if (err?.name === 'AbortError') return null;
  const status = err?.status;
  if (status === 400) return `${name} refused the request — try another model`;
  if (status === 401 || status === 403) return `your ${name} API key was rejected — check it in your account settings`;
  if (status === 404) return `${name} doesn't offer that model on your key — choose another`;
  if (status === 429) return `${name} says you are over your limit or out of credit — try again later`;
  if (status >= 500) return `${name} is having trouble — try again shortly`;
  return 'assistant request failed — try again';
}
