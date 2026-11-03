<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Quireloop logo">
</p>

<h1 align="center">Quireloop</h1>

<p align="center">A self-hosted, collaborative LaTeX editor for academic research.</p>
<p align="center">Created by <a href="https://github.com/arjunpogaku">Arjun Pogaku</a> · Academic use only · <a href="LICENSE">License</a></p>

Quireloop gives a lab or a single researcher a LaTeX workspace on hardware they
already own: source on the left, PDF on the right, and live collaboration
between them. Papers stay on your machine, with no per-seat subscription.

## Highlights

- **Real-time collaboration** with comments, chat and suggested changes
- **Work offline:** link a computer to a server, keep every paper on it, and
  sync automatically when the internet returns
- **Two-way SyncTeX:** double-click in the source or the PDF to find the same
  text in the other
- **Equation and citation previews** on hover, and pasted images that become
  figures
- **Version history** with side-by-side comparison, and a real git repository
  for every project
- **Works with your files:** open a folder in place, import from any git URL,
  or upload a `.zip`
- **Grammar check** in the editor, run privately on your own server
- **AI assistant** with a list of available models: your lab's local models or
  your own API key
- **Backups:** copies on the server every 10 minutes, and automatic copies on your own
  computer that can reach OneDrive or Dropbox
- **Lab accounts:** invitations, roles, two-factor sign-in, or the server's own
  logins

See the [full feature list](docs/features.md).

## Install

| | Personal | Server |
|---|---|---|
| **For** | One person on their own computer | A lab or team on a shared machine |
| **Setup** | Node.js, LaTeX, one `npm start` | Docker or systemd, behind HTTPS |
| **Accounts** | Just yours | Invitations, roles, optional server logins |
| **Guide** | **[Install on your computer](docs/install-personal.md)** | **[Install on a server](docs/install-server.md)** |

The quickest personal setup, once LaTeX is installed:

```bash
pip install quireloop
quireloop start
```

Or from the source code, with Node.js 22+:

```bash
git clone https://github.com/quireloop/quireloop.git
cd quireloop
npm install
npm run build --workspace=web
cd server && npm start
```

Then open http://localhost:4173. The first account becomes the admin.

## Documentation

| Guide | What it covers |
|---|---|
| [Install on your computer](docs/install-personal.md) | Setup, automatic start, updates |
| [Install on a server](docs/install-server.md) | Docker, systemd, HTTPS, server logins, backups, settings |
| [Admin guide](docs/admin-guide.md) | Running a server: users, AI models, grammar, backups, recovery |
| [User guide](docs/user-guide.md) | Illustrated quick start, then every feature |
| [Features](docs/features.md) | The complete feature list |
| [Where your data lives](docs/data.md) | Project files, git history, backups |
| [Releasing](docs/releasing.md) | Publishing a new version to PyPI |
| [Roadmap](docs/roadmap.md) | What is planned |

## Repository layout

```
server/    API, collaboration, LaTeX compile and SyncTeX (Fastify)
web/       Interface (React, CodeMirror 6, Vite)
deploy/    Example nginx, systemd, PAM and sudo files
scripts/   Installers, backups and the pip package build
docs/      Guides
packaging/ The pip package (built by scripts/build-pypi.sh)
assets/    Logo
data/      Accounts and projects (created on first run, never committed)
```

## Security

Quireloop is built for a trusted lab, not for open sign-up on the public
internet. Use HTTPS for anything beyond `localhost` or a network you trust. Each
person with edit access decides what LaTeX runs, so give it only to people you
trust; see [What a compile may touch](docs/install-server.md#what-a-compile-may-touch).

## License

Quireloop is licensed for **academic use only**: study, teaching and scholarly
research by students, researchers, and educational or research institutions.
Credit Quireloop and Arjun Pogaku in any work that used it;
[CITATION.cff](CITATION.cff) has a ready-made citation.

Any other use, including commercial use, needs written permission from
pchakri.rj@gmail.com. Quireloop is source-available, not open source. The
[LICENSE](LICENSE) file has the full terms.
