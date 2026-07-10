import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { PORT, HOST, PUBLIC_DIR } from './config.js';
import projectsRoutes from './routes/projects.js';
import filesRoutes from './routes/files.js';
import compileRoutes from './routes/compile.js';
import synctexRoutes from './routes/synctex.js';
import versionsRoutes from './routes/versions.js';
import registerMultipart from './plugins/multipart.js';

const app = Fastify({ logger: true });

// File content is uploaded as raw text, not JSON.
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
  done(null, body);
});

await registerMultipart(app);
await app.register(projectsRoutes);
await app.register(filesRoutes);
await app.register(compileRoutes);
await app.register(synctexRoutes);
await app.register(versionsRoutes);

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
