import { requireProjectAccess } from '../lib/authMiddleware.js';
import { findUserById } from '../lib/auth.js';
import * as comments from '../lib/comments.js';

// Comments are deliberately available to viewers too — commenting is
// reviewing, not editing, so requireProjectAccess (not requireProjectWrite)
// gates every route here.
export default async function commentsRoutes(app) {
  app.get('/api/projects/:id/comments', { preHandler: requireProjectAccess }, async (req) => {
    return comments.listThreads(req.ownerId, req.params.id, req.query?.file);
  });

  app.post('/api/projects/:id/comments', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { filePath, anchor, text } = req.body ?? {};
    if (!filePath || typeof filePath !== 'string') {
      return reply.code(400).send({ error: 'filePath is required' });
    }
    if (!anchor || typeof anchor.start !== 'string' || typeof anchor.end !== 'string') {
      return reply.code(400).send({ error: 'anchor with start/end is required' });
    }
    if (!comments.validateCommentText(text)) {
      return reply.code(400).send({ error: 'text must be 1-5000 characters' });
    }
    const user = await findUserById(req.userId);
    const thread = await comments.createThread(req.ownerId, req.params.id, {
      filePath,
      anchor,
      text,
      userId: req.userId,
      email: user?.email ?? '',
    });
    return reply.code(201).send(thread);
  });

  app.post('/api/projects/:id/comments/:threadId/messages', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { text } = req.body ?? {};
    if (!comments.validateCommentText(text)) {
      return reply.code(400).send({ error: 'text must be 1-5000 characters' });
    }
    const user = await findUserById(req.userId);
    const thread = await comments.addMessage(req.ownerId, req.params.id, req.params.threadId, {
      userId: req.userId,
      email: user?.email ?? '',
      text,
    });
    if (!thread) return reply.code(404).send({ error: 'thread not found' });
    return thread;
  });

  app.post('/api/projects/:id/comments/:threadId/resolve', { preHandler: requireProjectAccess }, async (req, reply) => {
    const { resolved } = req.body ?? {};
    const thread = await comments.setResolved(req.ownerId, req.params.id, req.params.threadId, !!resolved);
    if (!thread) return reply.code(404).send({ error: 'thread not found' });
    return thread;
  });

  app.delete('/api/projects/:id/comments/:threadId', { preHandler: requireProjectAccess }, async (req, reply) => {
    const thread = await comments.getThread(req.ownerId, req.params.id, req.params.threadId);
    if (!thread) return reply.code(404).send({ error: 'thread not found' });
    const isCreator = thread.createdBy === req.userId;
    const isOwner = req.projectRole === 'owner';
    if (!isCreator && !isOwner) {
      return reply.code(403).send({ error: 'only the thread creator or project owner can delete this' });
    }
    await comments.deleteThread(req.ownerId, req.params.id, req.params.threadId);
    return reply.code(204).send();
  });
}
