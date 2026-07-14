import * as collab from '../lib/collab.js';
import { requireProjectAccess } from '../lib/authMiddleware.js';
import { findUserById } from '../lib/auth.js';

export default async function collabRoutes(app) {
  app.get('/ws/:id/*', { websocket: true, preHandler: requireProjectAccess }, async (ws, req) => {
    const filePath = req.params['*'];

    // The client fires its syncStep1 the instant the socket opens — often
    // before the awaits below finish (getRoom reads the file from disk the
    // first time a room is created). The message handler must be attached
    // from the very first tick, buffering anything that arrives early, or
    // that opening sync request is silently dropped and the client hangs
    // at "syncing" until it reconnects against the now-cached room.
    let room = null;
    let closed = false;
    const early = [];

    const dispatch = (data) => {
      // A malformed or unknown frame must never escape the handler — a
      // throw here is an uncaught exception that takes down the process.
      try {
        collab.handleMessage(room, ws, data);
      } catch {
        ws.close(1003, 'invalid message');
      }
    };

    ws.on('message', (data) => {
      if (room) dispatch(data);
      else early.push(data);
    });
    ws.on('close', () => {
      closed = true;
      if (room) collab.removeConnection(room, ws);
    });

    const user = await findUserById(req.userId);
    const readyRoom = await collab.getRoom(req.ownerId, req.params.id, filePath);
    if (closed) return;

    collab.addConnection(readyRoom, ws, req.userId, user?.email ?? 'unknown', req.projectRole);
    room = readyRoom;
    collab.sendInitialState(room, ws);
    for (const data of early) {
      dispatch(data);
    }
  });

  app.get('/api/projects/:id/recent-editors/*', { preHandler: requireProjectAccess }, async (req) => {
    return collab.getRecentEditors(req.ownerId, req.params.id, req.params['*']);
  });
}
