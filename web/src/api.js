const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(BASE + path, options);
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  listTemplates: () => request('/templates'),
  listProjects: () => request('/projects'),
  createProject: (name, templateId) =>
    request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, templateId }),
    }),
  importFromGit: (name, gitUrl, token) =>
    request('/projects/import-git', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, gitUrl, token }),
    }),
  uploadProjectZip: (name, file) => {
    const form = new FormData();
    form.append('file', file);
    const qs = name ? `?name=${encodeURIComponent(name)}` : '';
    return request(`/projects/upload-zip${qs}`, { method: 'POST', body: form });
  },
  getProject: (id) => request(`/projects/${id}`),
  renameProject: (id, name) =>
    request(`/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  setCompiler: (id, compiler) =>
    request(`/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ compiler }),
    }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  downloadUrl: (id) => `${BASE}/projects/${id}/download`,
  clean: (id) => request(`/projects/${id}/clean`, { method: 'POST' }),

  shareProject: (id, email, role) =>
    request(`/projects/${id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    }),
  unshareProject: (id, userId) =>
    request(`/projects/${id}/unshare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    }),
  setCollaboratorRole: (id, userId, role) =>
    request(`/projects/${id}/collaborators/${userId}/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    }),

  createShareLink: (id, role) =>
    request(`/projects/${id}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
  listShareLinks: (id) => request(`/projects/${id}/share-links`),
  revokeShareLink: (id, token) => request(`/projects/${id}/share-links/${token}`, { method: 'DELETE' }),
  joinShareLink: (token) => request(`/share-links/${token}/join`, { method: 'POST' }),

  readFile: (id, path) => request(`/projects/${id}/files/${path}`),
  writeFile: (id, path, content) =>
    request(`/projects/${id}/files/${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: content,
    }),
  deleteFile: (id, path) => request(`/projects/${id}/files/${path}`, { method: 'DELETE' }),
  createFolder: (id, path) =>
    request(`/projects/${id}/folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  renameFile: (id, oldPath, newPath) =>
    request(`/projects/${id}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
    }),
  uploadFile: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return request(`/projects/${id}/upload`, { method: 'POST', body: form });
  },

  compile: (id) => request(`/projects/${id}/compile`, { method: 'POST' }),
  pdfUrl: (id) => `${BASE}/projects/${id}/pdf?t=${Date.now()}`,

  searchProject: (id, q) => request(`/projects/${id}/search?q=${encodeURIComponent(q)}`),

  synctexToSource: (id, page, x, y) =>
    request(`/projects/${id}/synctex/to-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page, x, y }),
    }),
  synctexToPdf: (id, file, line) =>
    request(`/projects/${id}/synctex/to-pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, line }),
    }),
  listVersions: (id) => request(`/projects/${id}/versions`),
  saveVersion: (id, label) =>
    request(`/projects/${id}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    }),
  restoreVersion: (id, versionId) => request(`/projects/${id}/versions/${versionId}/restore`, { method: 'POST' }),

  gitStatus: (id) => request(`/projects/${id}/git/status`),
  gitCommit: (id, message) =>
    request(`/projects/${id}/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }),
  setGitRemote: (id, url, token) =>
    request(`/projects/${id}/git/remote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, token }),
    }),
  gitPush: (id) => request(`/projects/${id}/git/push`, { method: 'POST' }),
  gitPull: (id) => request(`/projects/${id}/git/pull`, { method: 'POST' }),

  recentEditors: (id, path) => request(`/projects/${id}/recent-editors/${path}`),

  listComments: (id, filePath) =>
    request(`/projects/${id}/comments${filePath ? `?file=${encodeURIComponent(filePath)}` : ''}`),
  createComment: (id, filePath, anchor, text) =>
    request(`/projects/${id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath, anchor, text }),
    }),
  replyToComment: (id, threadId, text) =>
    request(`/projects/${id}/comments/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  resolveComment: (id, threadId, resolved) =>
    request(`/projects/${id}/comments/${threadId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolved }),
    }),
  deleteComment: (id, threadId) => request(`/projects/${id}/comments/${threadId}`, { method: 'DELETE' }),

  listChat: (id, after) => request(`/projects/${id}/chat${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  sendChat: (id, text) =>
    request(`/projects/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
};
