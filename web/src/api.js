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
};
