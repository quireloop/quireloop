import { nanoid } from 'nanoid';
import { INVITES_FILE } from '../config.js';
import { readJson, updateJson, updateJsonWithResult } from './jsonStore.js';

const MODE = { mode: 0o600 };

export async function createInvite(adminId) {
  const invite = {
    code: nanoid(12),
    createdBy: adminId,
    createdAt: new Date().toISOString(),
    usedBy: null,
    usedAt: null,
  };
  await updateJson(INVITES_FILE, [], (invites) => [...invites, invite], MODE);
  return invite;
}

export async function listInvites() {
  return readJson(INVITES_FILE, []);
}

export async function isInviteValid(code) {
  const invites = await readJson(INVITES_FILE, []);
  const invite = invites.find((i) => i.code === code);
  return Boolean(invite && !invite.usedBy);
}

// Check-and-mark under the file's lock, so two signups racing on the same
// single-use code can't both observe it as unused and both succeed. Doing the
// read and the write in one function is not enough on its own — the await
// between them is a yield point where the other request runs — which is why
// this goes through updateJsonWithResult rather than a plain read/write pair.
export async function consumeInvite(code, userId) {
  return updateJsonWithResult(
    INVITES_FILE,
    [],
    (invites) => {
      const invite = invites.find((i) => i.code === code);
      if (!invite || invite.usedBy) return { value: undefined, result: false };
      return {
        value: invites.map((i) =>
          i.code === code ? { ...i, usedBy: userId, usedAt: new Date().toISOString() } : i
        ),
        result: true,
      };
    },
    MODE
  );
}

export async function revokeInvite(code) {
  return updateJsonWithResult(
    INVITES_FILE,
    [],
    (invites) => {
      const remaining = invites.filter((i) => i.code !== code || i.usedBy);
      if (remaining.length === invites.length) return { value: undefined, result: false };
      return { value: remaining, result: true };
    },
    MODE
  );
}
