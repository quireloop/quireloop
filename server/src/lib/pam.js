import { execa } from 'execa';
import { PAM_ENABLED, PAM_HELPER_COMMAND } from '../config.js';

// Talks to deploy/quireloop-pam-auth. See config.js for why authentication
// lives in a separate privileged process rather than in this one.

const TIMEOUT_MS = 15_000;

export function pamEnabled() {
  return PAM_ENABLED;
}

/**
 * Checks a UNIX account's credentials. `responses` answers the PAM stack's
 * prompts in order — with the stack in deploy/quireloop.pam.example that is
 * [password, verification code].
 *
 * Returns { username, uid, gid, home, fullName } on success, or null. Never
 * distinguishes "no such account" from "wrong password": the helper collapses
 * every failure into one answer so this API can't be used to enumerate who has
 * an account on the box.
 */
export async function authenticate(username, responses) {
  if (!PAM_ENABLED) return null;

  const [command, ...args] = PAM_HELPER_COMMAND;
  let result;
  try {
    result = await execa(command, args, {
      // Credentials go in on stdin and nowhere else — an argument would be
      // world-readable in /proc/<pid>/cmdline for as long as the process runs.
      input: JSON.stringify({ username, responses }),
      timeout: TIMEOUT_MS,
      // A rejected login is an expected outcome, not an exception: the helper
      // exits non-zero for it, and stdout still holds the structured answer.
      reject: false,
      // The helper gets an explicit allowlist, not this process's environment,
      // which holds assistant API keys among other things.
      //
      // PATH has to be in it. The command is resolved through PATH — the
      // default one is `sudo`, a bare name — so an empty environment means it
      // is never found at all, and `reject: false` turns that into an empty
      // reply rather than a visible spawn error. The QUIRELOOP_PAM_* names
      // matter for the opposite reason: `sudo` keeps variables from *its* own
      // environment, so they have to be handed to sudo for the env_keep rule
      // in deploy/quireloop-sudoers.example to have anything to preserve.
      extendEnv: false,
      env: Object.fromEntries(
        ['PATH', 'QUIRELOOP_PAM_SERVICE', 'QUIRELOOP_PAM_MIN_UID', 'QUIRELOOP_PAM_ALLOW_GROUP']
          .filter((name) => process.env[name])
          .map((name) => [name, process.env[name]])
      ),
    });
  } catch (err) {
    // Only a timeout or a missing/unrunnable helper reaches here.
    throw new Error(`could not run the PAM helper: ${err.shortMessage ?? err.message}`);
  }

  // `reject: false` means a helper that never started looks the same as one
  // that ran and failed, so check for it explicitly — "command not found" and
  // "wrong password" need very different responses from whoever is reading
  // the log.
  if (result.failed && !result.stdout) {
    throw new Error(
      `could not run the PAM helper (${PAM_HELPER_COMMAND.join(' ')}): ` +
        `${result.shortMessage ?? result.stderr ?? 'no output'}`
    );
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    // No parseable answer means the helper is misconfigured (a broken sudoers
    // rule prints its complaint on stderr and produces no stdout at all).
    // Surfacing it as "wrong password" would send an operator hunting in
    // entirely the wrong place, so it's an error, not a denial.
    const detail = (result.stderr || result.stdout || '').trim().split('\n')[0];
    throw new Error(`the PAM helper returned no usable answer${detail ? `: ${detail}` : ''}`);
  }

  if (!payload.ok) return null;
  if (!payload.username || typeof payload.uid !== 'number' || !payload.home) {
    throw new Error('the PAM helper returned an incomplete account record');
  }

  return {
    username: payload.username,
    uid: payload.uid,
    gid: payload.gid,
    home: payload.home,
    fullName: payload.fullName || '',
  };
}
