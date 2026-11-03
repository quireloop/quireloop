import { requireAuth, requireProjectAccess } from '../lib/authMiddleware.js';
import { checkGrammar, grammarEnabled, latexToPlainText } from '../lib/grammar.js';

const LANGUAGES = ['auto', 'en-US', 'en-GB'];

export default async function grammarRoutes(app) {
  app.get('/api/grammar/config', { preHandler: requireAuth }, async () => ({ enabled: grammarEnabled() }));

  // The text comes from the browser rather than the disk: it is what's on
  // screen, and the positions in the answer have to line up with it.
  app.post(
    '/api/projects/:id/grammar',
    { preHandler: requireProjectAccess, bodyLimit: 2 * 1024 * 1024 },
    async (req, reply) => {
      if (!grammarEnabled()) return reply.code(503).send({ error: 'grammar checking is not set up on this server' });
      const { text, language = 'auto' } = req.body ?? {};
      if (typeof text !== 'string') return reply.code(400).send({ error: 'text required' });
      if (!LANGUAGES.includes(language)) return reply.code(400).send({ error: 'unsupported language' });
      try {
        return { matches: await checkGrammar(text, language) };
      } catch (err) {
        app.log.warn({ err }, 'grammar check failed');
        return reply.code(502).send({ error: 'the grammar checker did not answer' });
      }
    },
  );

  app.post('/api/projects/:id/plain-text', { preHandler: requireProjectAccess, bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    if (typeof req.body?.text !== 'string') return reply.code(400).send({ error: 'text required' });
    return { text: latexToPlainText(req.body.text) };
  });
}
