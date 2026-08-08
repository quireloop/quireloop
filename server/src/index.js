import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifySecureSession from '@fastify/secure-session';
import fastifyWebsocket from '@fastify/websocket';
import fastifyHelmet from '@fastify/helmet';
import fs from 'node:fs';
import { PUBLIC_DIR, BASE_PATH } from './config.js';
import { loadOrCreateSessionKey, migrateUserRoles } from './lib/auth.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import projectsRoutes from './routes/projects.js';
import libraryRoutes from './routes/library.js';
import filesRoutes from './routes/files.js';
import compileRoutes from './routes/compile.js';
import searchRoutes from './routes/search.js';
import synctexRoutes from './routes/synctex.js';
import versionsRoutes from './routes/versions.js';
import gitRoutes from './routes/git.js';
import collabRoutes from './routes/collab.js';
import commentsRoutes from './routes/comments.js';
import suggestionsRoutes from './routes/suggestions.js';
import chatRoutes from './routes/chat.js';
import assistantRoutes from './routes/assistant.js';
import registerMultipart from './plugins/multipart.js';

// Building the app is separated from starting it so the test suite can drive
// the real route stack in-process via app.inject(), with no port to bind and
// no ordering race between server startup and the first request. src/start.js
// is the entry point that actually listens.
export async function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger });

  // File content is uploaded as raw text, not JSON.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
    done(null, body);
  });

  await migrateUserRoles();

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'self'", 'blob:'], // PDF preview is served same-origin as a blob
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(fastifyCookie);
  await app.register(fastifySecureSession, {
    key: await loadOrCreateSessionKey(),
    cookie: {
      // Scoped to BASE_PATH when mounted under a subpath (default '/')  so a
      // deployment sharing a domain with sibling apps (e.g. example.org's
      // /jupyter/, /cloud/, ...) doesn't send this session cookie to every
      // request on the domain, only requests actually bound for Quireloop.
      path: BASE_PATH || '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.QUIRELOOP_SECURE_COOKIES === 'true',
    },
  });

  await registerMultipart(app);
  await app.register(fastifyWebsocket);
  // Every route file already defines its full path (e.g. '/api/health',
  // '/ws/:id/*'); the prefix here shifts all of them under BASE_PATH as a
  // group so the app can be mounted at the domain root (default, empty
  // prefix) or behind a reverse proxy subpath like '/quireloop'.
  for (const routes of [
    healthRoutes,
    authRoutes,
    adminRoutes,
    projectsRoutes,
    libraryRoutes,
    filesRoutes,
    compileRoutes,
    searchRoutes,
    synctexRoutes,
    versionsRoutes,
    gitRoutes,
    collabRoutes,
    commentsRoutes,
    suggestionsRoutes,
    chatRoutes,
    assistantRoutes,
  ]) {
    await app.register(routes, { prefix: BASE_PATH });
  }

  if (fs.existsSync(PUBLIC_DIR)) {
    await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: `${BASE_PATH}/` });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url || '';
      if (url.startsWith(`${BASE_PATH}/api`) || (BASE_PATH && !url.startsWith(BASE_PATH))) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
