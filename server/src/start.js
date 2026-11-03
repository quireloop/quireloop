import { buildApp } from './index.js';
import { PORT, HOST } from './config.js';
import { sandboxStatus } from './lib/compileSandbox.js';
import { startSyncClient, stopSyncClient } from './lib/syncClient.js';
import { startFolderCopy, stopFolderCopy } from './lib/folderCopy.js';

const app = await buildApp();

const sandbox = await sandboxStatus();
if (sandbox === 'on') app.log.info('compile sandbox: on');
else app.log.warn(`compile sandbox: ${sandbox}. LaTeX runs with this server's full access, see docs/install-server.md`);

// A hard kill mid-request could cut off a compile or a collaborative-edit
// flush halfway. LaunchAgent and systemd both send SIGTERM before SIGKILL, so
// draining in-flight requests here is the normal restart path, not an edge
// case. (Torn JSON state files are separately prevented by the atomic writes
// in lib/jsonStore.js.)
await startSyncClient(app.log);
await startFolderCopy(app.log);

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);
    try {
      stopSyncClient();
      stopFolderCopy();
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'error during shutdown');
      process.exit(1);
    }
  });
}

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`IDE server listening on ${address}`);
});
