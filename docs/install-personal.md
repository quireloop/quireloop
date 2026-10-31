# Install on your own computer

For one person writing on their own machine. It takes a few minutes if LaTeX is
already installed. To set Quireloop up for a lab, see
[Install on a server](install-server.md) instead.

Quireloop is licensed for [academic use only](../README.md#license).

## 1. Install what it needs

You need **Node.js 22 or newer**, **git**, **unzip**, and a **LaTeX
distribution** that includes `latexmk` and `synctex`.

| System | How |
|---|---|
| **Ubuntu / Debian** | Install [Node.js](https://nodejs.org/) 22+, then run `npm run setup:texlive` after step 2. It installs LaTeX, git and unzip. |
| **macOS** | Install [Node.js](https://nodejs.org/) 22+ and [MacTeX](https://tug.org/mactex/). git and unzip come with macOS. |
| **Windows** | Install [WSL](https://learn.microsoft.com/windows/wsl/install) with Ubuntu, then follow the Ubuntu steps inside it. |

Check that LaTeX is on your `PATH`:

```bash
latexmk --version
synctex version
```

## 2. Download and build

```bash
git clone https://github.com/arjunpogaku/quireloop.git
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
outside the folder.

## Start it automatically

**macOS:** after the build, run this from the `quireloop` folder. Quireloop then
starts when you log in and restarts if it crashes.

```bash
npm run service:install
```

Logs are in `~/Library/Logs/Quireloop/`. To remove it, run
`npm run service:uninstall`.

**Linux:** create `~/.config/systemd/user/quireloop.service`, replacing the two
paths with your own:

```ini
[Unit]
Description=Quireloop

[Service]
WorkingDirectory=/home/YOU/quireloop/server
ExecStart=/usr/bin/node src/start.js
Restart=on-failure

[Install]
WantedBy=default.target
```

Then enable it:

```bash
systemctl --user enable --now quireloop
```

## Update to a new version

From the `quireloop` folder:

```bash
git pull
npm install
npm run build --workspace=web
```

Then restart Quireloop. Your `data/` folder is not touched.

## Options

Use another port with `PORT=8080 npm start`.

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
