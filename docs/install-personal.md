# Install on your own computer

For one person writing on their own machine: Windows, macOS or Linux, each
running Quireloop directly. It takes a few minutes if LaTeX is already installed. To set Quireloop up for a lab, see
[Install on a server](install-server.md) instead.

Quireloop is licensed for [academic use only](../README.md#license).

## Quickest: install with pip

You need Python 3.9 or newer and LaTeX (step 1 below says how). Node.js comes
with the package.

```bash
pip install quireloop
quireloop doctor
quireloop start
```

Open http://localhost:4173; the first account becomes the admin. `quireloop
doctor` lists anything missing. By default only this computer can connect;
`quireloop start --host 0.0.0.0` lets others on your network in. Papers and
accounts are kept in `~/.local/share/quireloop` on Linux,
`~/Library/Application Support/Quireloop` on macOS and
`%LOCALAPPDATA%\Quireloop` on Windows, or wherever `--data-dir` points. `pip install --upgrade quireloop` updates it and leaves them alone.

The rest of this page installs from the source code instead.

## 1. Install what it needs

You need **Node.js 22 or newer**, **git**, and a **LaTeX distribution** that
includes `latexmk` and `synctex`. Linux and macOS also need **unzip**; Windows
uses its own built-in `tar` instead.

| System | How |
|---|---|
| **Ubuntu / Debian** | Install [Node.js](https://nodejs.org/) 22+, then run `npm run setup:texlive` after step 2. It installs LaTeX, git and unzip. |
| **macOS** | Install [Node.js](https://nodejs.org/) 22+ and [MacTeX](https://tug.org/mactex/). git and unzip come with macOS. |
| **Windows** | Install [Node.js](https://nodejs.org/) 22+, [Git for Windows](https://git-scm.com/download/win) and [TeX Live](https://tug.org/texlive/windows.html). Windows 10 or 11 is needed. MiKTeX works too, but its `latexmk` also needs [Strawberry Perl](https://strawberryperl.com/); TeX Live includes Perl. Run the commands below in PowerShell. |

Check that LaTeX is on your `PATH`:

```bash
latexmk --version
synctex version
```

## 2. Download and build

```bash
git clone https://github.com/quireloop/quireloop.git
cd quireloop
npm install
npm run build --workspace=web
```

## 3. Start it

```bash
cd server
npm start
```

Open **http://localhost:4173** and sign up. The first account becomes the admin.

Your papers and account are stored in `data/` inside this folder. Read
[Where your data lives](data.md) before you rely on it, and keep a backup
outside the folder with your usual backup tool (Time Machine, File History, or
a copy to another disk). The server's backup script is for Linux servers only.

## Start it automatically

After the build, run this from the `quireloop` folder on any of the three
systems. Quireloop then starts when you log in and restarts if it crashes. No
admin rights are needed.

```bash
npm run service:install
```

| System | What it sets up | Logs |
|---|---|---|
| **macOS** | a LaunchAgent | `~/Library/Logs/Quireloop/` |
| **Linux** | a systemd user service, `~/.config/systemd/user/quireloop.service` | `journalctl --user -u quireloop` |
| **Windows** | a Task Scheduler task named Quireloop | `%LOCALAPPDATA%\Quireloop\Logs\` |

Run it again after moving the `quireloop` folder or installing a new LaTeX, so
it picks up the new paths. To remove it, run `npm run service:uninstall`.

On Linux, a user service stops when you log out unless you run
`loginctl enable-linger` once.

## Update to a new version

From the `quireloop` folder:

```bash
git pull
npm install
npm run build --workspace=web
```

Then restart Quireloop. Your `data/` folder is not touched.

## Options

Use another port with `PORT=8080 npm start` (in PowerShell:
`$env:PORT=8080; npm start`).

Compiling runs LaTeX with your own access to the computer, and LaTeX can read
any file you can. That is fine for your own papers. If you compile papers from
co-authors you don't fully trust, do it on Linux with the
[compile sandbox](install-server.md#what-a-compile-may-touch), which is the
only thing that keeps a compile inside its project; macOS and Windows have no
equivalent.

Quireloop listens on all network interfaces, so other devices on your network
can open `http://<this-computer's-address>:4173`. Only do this on a network you
trust; anything further needs the HTTPS setup in the
[server guide](install-server.md#tls-nginx-in-front-of-either-option).

## Working on Quireloop itself

Run the API and the hot-reloading interface in two terminals, then open
`http://localhost:5173`:

```bash
cd server && npm start
```

```bash
cd web && npm run dev
```

Run the tests with `cd server && npm test`.
