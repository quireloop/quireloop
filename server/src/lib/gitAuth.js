// Most git hosts that use token auth over HTTPS (GitHub, GitLab, and
// the hosted editor's git bridge) accept the token as the URL's username with an
// empty password — no separate "password" concept to ask the user for.
export function withToken(gitUrl, token) {
  const url = new URL(gitUrl);
  if (token) {
    url.username = token;
    url.password = '';
  }
  return url.toString();
}

// Strips embedded credentials before ever showing a remote URL back to the
// user or storing it somewhere that isn't the credentials file itself.
export function withoutToken(gitUrl) {
  const url = new URL(gitUrl);
  url.username = '';
  url.password = '';
  return url.toString();
}
