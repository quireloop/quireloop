// Token auth over HTTPS, in the one form every major host accepts:
// username "git", token as the password. GitHub and GitLab take a PAT as
// the password with any username, and some hosts require exactly "git" +
// token. (Token-as-username with an empty password — the previous form here —
// works on GitHub but not everywhere.)
export function withToken(gitUrl, token) {
  const url = new URL(gitUrl);
  if (token) {
    url.username = 'git';
    url.password = token;
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
