import { requireProjectAccess } from '../lib/authMiddleware.js';
import { findUserById } from '../lib/auth.js';
import * as chat from '../lib/chat.js';

// Viewers can chat too — same reasoning as comments, this doesn't touch
// the document.
export default async function chatRoutes(app) {
  app.get('/api/projects/:id/chat', { preHandler: requireProjectAccess }, async (req) => {
    return chat.listMessages(req.ownerId, req.params.id, req.query?.after);
  });

  app.post('/api/projects/:id/chat', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { text } = req.body ?? {};
    if (!chat.validateChatText(text)) {
      return reply.code(400).send({ error: 'text must be 1-2000 characters' });
    }
    const user = await findUserById(req.userId);
    const message = await chat.addMessage(req.ownerId, req.params.id, {
      userId: req.userId,
      email: user?.email ?? '',
      text,
    });
    return reply.code(201).send(message);
  });
}
