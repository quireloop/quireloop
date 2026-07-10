import fastifyMultipart from '@fastify/multipart';

export default async function registerMultipart(app) {
  await app.register(fastifyMultipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });
}
