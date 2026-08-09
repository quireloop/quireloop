#!/usr/bin/env node
// Stands in for deploy/quireloop-pam-auth in tests. A real PAM stack can't be
// exercised from a test suite — it needs root, /etc/pam.d, and actual system
// accounts — so what's under test here is everything on Quireloop's side of
// the protocol: the login route, provisioning, rate limiting, and the mapping
// from a UNIX home directory to a library root.
//
// Speaks the same contract as the real helper: one JSON object in on stdin,
// one out on stdout, non-zero exit on rejection.
//
// Its account table is read from a JSON file named in argv, deliberately not
// from the environment: lib/pam.js hands the helper a narrow allowlist of
// variables, so anything else it needed would not survive the call — which is
// exactly the constraint the real helper runs under too.
//
//   { "accounts": { "<user>": { password, code, uid, gid, home, fullName } },
//     "broken": false }

import { readFileSync } from 'node:fs';

function reject() {
  process.stdout.write(JSON.stringify({ ok: false, error: 'authentication failed' }) + '\n');
  process.exit(1);
}

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));

if (config.broken) {
  // Models a misconfigured sudoers rule: a complaint on stderr and nothing
  // usable on stdout. Must surface as a server fault, not a wrong password.
  process.stderr.write('sudo: a password is required\n');
  process.exit(1);
}

// Read the same blocking way the real helper does, so a test that forgets to
// send input fails fast instead of hanging.
let request;
try {
  request = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  reject();
}

const account = config.accounts[request.username];
const [password, code] = request.responses ?? [];

if (!account || account.password !== password || (account.code ?? '') !== (code ?? '')) {
  reject();
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    username: request.username,
    uid: account.uid ?? 1000,
    gid: account.gid ?? 1000,
    home: account.home,
    fullName: account.fullName ?? '',
  }) + '\n'
);
