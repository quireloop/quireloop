<p align="center">
  <img src="https://raw.githubusercontent.com/arjunpogaku/quireloop/main/assets/png/logo-256.png" width="96" height="96" alt="Quireloop logo">
</p>

# Quireloop

A self-hosted, collaborative LaTeX editor for academic research: source on the
left, PDF on the right, and live collaboration between them. Papers stay on
your own machine.

## Install

You need Python 3.9 or newer and a LaTeX installation (TeX Live or MacTeX).
Node.js comes with the package.

```bash
pip install quireloop
quireloop doctor
quireloop start
```

Then open http://localhost:4173. The first account becomes the admin.

`quireloop start --host 0.0.0.0` lets other computers on your network connect.
Papers and accounts are kept in `~/.local/share/quireloop` on Linux and
`~/Library/Application Support/Quireloop` on macOS; `--data-dir` picks another
folder. On Windows, install it inside WSL.

## Documentation

- [Install on your computer](https://github.com/arjunpogaku/quireloop/blob/main/docs/install-personal.md)
- [Install on a server](https://github.com/arjunpogaku/quireloop/blob/main/docs/install-server.md)
- [User guide](https://github.com/arjunpogaku/quireloop/blob/main/docs/user-guide.md)
- [Admin guide](https://github.com/arjunpogaku/quireloop/blob/main/docs/admin-guide.md)

## License

Academic use only: study, teaching and scholarly research. Credit Quireloop and
Arjun Pogaku in any work that used it. Any other use needs written permission.
See the LICENSE file in this package for the full terms. Quireloop is
source-available, not open source.
