import * as collab from '../lib/collab.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';
import { findUserById } from '../lib/auth.js';

export default async function collabRoutes(app) {
  app.get('/ws/:id/*', { websocket: true, preHandler: requireProjectAccess }, async (ws, req) => {
    const filePath = req.params['*'];
    const user = await findUserById(req.userId);
    const room = await collab.getRoom(req.ownerId, req.params.id, filePath);

    collab.addConnection(room, ws, req.userId, user?.email ?? 'unknown');
    collab.sendInitialState(room, ws);

    ws.on('message', (data) => collab.handleMessage(room, ws, data));
    ws.on('close', () => collab.removeConnection(room, ws));
  });

  app.get('/api/projects/:id/recent-editors/*', { preHandler: requireProjectAccess }, async (req) => {
    return collab.getRecentEditors(req.ownerId, req.params.id, req.params['*']);
  });
}
