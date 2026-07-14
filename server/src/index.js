import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifySecureSession from '@fastify/secure-session';
import fastifyWebsocket from '@fastify/websocket';
import fs from 'node:fs';
import { PORT, HOST, PUBLIC_DIR } from './config.js';
import { loadOrCreateSessionKey, migrateUserRoles } from './lib/auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import projectsRoutes from './routes/projects.js';
import filesRoutes from './routes/files.js';
import compileRoutes from './routes/compile.js';
import searchRoutes from './routes/search.js';
import synctexRoutes from './routes/synctex.js';
import versionsRoutes from './routes/versions.js';
import gitRoutes from './routes/git.js';
import collabRoutes from './routes/collab.js';
import commentsRoutes from './routes/comments.js';
import chatRoutes from './routes/chat.js';
import registerMultipart from './plugins/multipart.js';

const app = Fastify({ logger: true });

// File content is uploaded as raw text, not JSON.
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
  done(null, body);
});

await migrateUserRoles();

await app.register(fastifyCookie);
await app.register(fastifySecureSession, {
  key: await loadOrCreateSessionKey(),
  cookie: {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.QUIRELOOP_SECURE_COOKIES === 'true',
  },
});

await registerMultipart(app);
await app.register(fastifyWebsocket);
await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(projectsRoutes);
await app.register(filesRoutes);
await app.register(compileRoutes);
await app.register(searchRoutes);
await app.register(synctexRoutes);
await app.register(versionsRoutes);
await app.register(gitRoutes);
await app.register(collabRoutes);
await app.register(commentsRoutes);
await app.register(chatRoutes);

if (fs.existsSync(PUBLIC_DIR)) {
  await app.register(fastifyStatic, { root: PUBLIC_DIR });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
}

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`IDE server listening on ${address}`);
});
