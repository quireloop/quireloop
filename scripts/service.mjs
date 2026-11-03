// `npm run service:install` / `service:uninstall`: starts Quireloop when you
// log in and restarts it if it crashes, using what each system already has.
// macOS: a LaunchAgent. Linux: a systemd user service. Windows: a Task
// Scheduler task. None needs admin rights; this is for one person's computer,
// and a lab server uses deploy/quireloop.service.example instead.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const action = process.argv[2];
const repo = path.resolve(import.meta.dirname, '..');
const server = path.join(repo, 'server');
const port = process.env.PORT || '4173';

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function checkBuilt() {
  if (!fs.existsSync(path.join(repo, 'node_modules'))) {
    throw new Error("Dependencies aren't installed yet: run 'npm install' from the repo root first.");
  }
  if (!fs.existsSync(path.join(server, 'public'))) {
    throw new Error("No build found yet: run 'npm run build --workspace=web' first.");
  }
}

function linux() {
  const unitDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user');
  const unit = path.join(unitDir, 'quireloop.service');
  if (action === 'uninstall') {
    run('systemctl', ['--user', 'disable', '--now', 'quireloop']);
    fs.rmSync(unit, { force: true });
    return run('systemctl', ['--user', 'daemon-reload']);
  }
  checkBuilt();
  fs.mkdirSync(unitDir, { recursive: true });
  // PATH is the installing shell's, so latexmk and git are found the same way
  // they are in a terminal.
  fs.writeFileSync(
    unit,
    [
      '[Unit]',
      'Description=Quireloop',
      '',
      '[Service]',
      `WorkingDirectory=${server}`,
      `ExecStart=${process.execPath} src/start.js`,
      `Environment="PATH=${process.env.PATH}"`,
      `Environment=PORT=${port}`,
      'Restart=on-failure',
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n')
  );
  run('systemctl', ['--user', 'daemon-reload']);
  const status = run('systemctl', ['--user', 'enable', '--now', 'quireloop']);
  if (status === 0) {
    console.log(`Quireloop is running and will start when you log in: http://localhost:${port}`);
    console.log('Logs: journalctl --user -u quireloop');
  }
  return status;
}

function windows() {
  const script = path.join(repo, 'scripts', `${action}-windows-task.ps1`);
  if (action === 'install') checkBuilt();
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (action === 'install') args.push('-Node', process.execPath, '-Server', server, '-Port', port);
  return run('powershell.exe', args);
}

function mac() {
  return run('bash', [path.join(repo, 'scripts', `${action}-launchagent.sh`)]);
}

if (action !== 'install' && action !== 'uninstall') {
  console.error('usage: node scripts/service.mjs install|uninstall');
  process.exit(2);
}
try {
  const byPlatform = { darwin: mac, linux, win32: windows };
  const handler = byPlatform[process.platform];
  if (!handler) throw new Error(`Starting automatically isn't set up for ${process.platform}; run 'npm start' in server/.`);
  process.exit(handler());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
