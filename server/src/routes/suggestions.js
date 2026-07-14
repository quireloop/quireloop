import { requireProjectAccess, requireProjectWrite } from '../lib/authMiddleware.js';
import { findUserById } from '../lib/auth.js';
import * as suggestions from '../lib/suggestions.js';

// Viewers can see suggestions (requireProjectAccess on GET), but creating
// or removing one requires write access — suggesting either inserts text
// into the shared doc immediately (insert-type) or stages a pending
// deletion of it (delete-type), both of which are edits a viewer can't
// make. Accept/reject share the same DELETE route: both end in the record
// being removed, the doc edit (if any) happens client-side first.
export default async function suggestionsRoutes(app) {
  app.get('/api/projects/:id/suggestions', { preHandler: requireProjectAccess }, async (req) => {
    return suggestions.listSuggestions(req.ownerId, req.params.id, req.query?.file);
  });

  app.post('/api/projects/:id/suggestions', { preHandler: requireProjectWrite }, async (req, reply) => {
    const { filePath, type, anchor } = req.body ?? {};
    if (!filePath || typeof filePath !== 'string') {
      return reply.code(400).send({ error: 'filePath is required' });
    }
    if (!suggestions.validateSuggestionType(type)) {
      return reply.code(400).send({ error: "type must be 'insert' or 'delete'" });
    }
    if (!anchor || typeof anchor.start !== 'string' || typeof anchor.end !== 'string') {
      return reply.code(400).send({ error: 'anchor with start/end is required' });
    }
    const user = await findUserById(req.userId);
    const record = await suggestions.createSuggestion(req.ownerId, req.params.id, {
      filePath,
      type,
      anchor,
      userId: req.userId,
      email: user?.email ?? '',
    });
    return reply.code(201).send(record);
  });

  app.delete('/api/projects/:id/suggestions/:suggestionId', { preHandler: requireProjectWrite }, async (req, reply) => {
    const removed = await suggestions.removeSuggestion(req.ownerId, req.params.id, req.params.suggestionId);
    if (!removed) return reply.code(404).send({ error: 'suggestion not found' });
    return reply.code(204).send();
  });
}
