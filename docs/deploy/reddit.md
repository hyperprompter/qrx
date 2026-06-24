# Deploying QRX to Reddit (Devvit)

QRX runs inside Reddit posts via [Devvit](https://developers.reddit.com), Reddit's developer platform. When deployed, a moderator can create a post that renders the full QRX desktop — icons, windows, the REPL — inside the Reddit feed.

## Prerequisites

- Node.js 22.2.0 or higher
- A Reddit account
- A subreddit you moderate with fewer than 200 subscribers (for testing)

## One-time setup

### 1. Install dependencies

From the project root:

```bash
npm install
```

This installs the Devvit CLI along with everything else. The CLI is a dev dependency — it never gets bundled into your app.

### 2. Log in to Reddit via the CLI

```bash
npm run login:reddit
```

This opens a browser window asking you to authorise the Devvit CLI with your Reddit account. Your token is saved locally at `~/.devvit/token` and refreshes automatically.

### 3. Create a Reddit app

Go to [developers.reddit.com/new](https://developers.reddit.com/new) and create a new app. Note the name you choose — it must be 3–16 characters, lowercase letters, numbers, and hyphens only.

Then open `devvit.json` at the project root and set the `name` field to match:

```json
{
  "name": "your-app-name",
  ...
}
```

### 4. Upload the app to Reddit

```bash
npm run build:reddit
npx devvit upload
```

`upload` registers your app with Reddit's developer platform and creates a private test subreddit for you (e.g. `r/your-app-name_dev`). You only need to run `upload` once, or again after changing `devvit.json`.

## Development workflow

### Build and start a playtest session

```bash
npm run build:reddit
npm run dev:reddit
```

`dev:reddit` runs `devvit playtest r/llm_os_dev` — replace `llm_os_dev` with your own test subreddit name if different. Update the script in `package.json` to match.

The playtest command uploads your latest build to Reddit and gives you a URL like:

```
https://www.reddit.com/r/your-app_dev/?playtest=your-app-name
```

Open that URL. You'll see your test subreddit.

### Create a test post

In the subreddit, click the `...` menu. You should see **New QRX Post**. Click it. A post is created and the QRX desktop loads inside it.

### Iterate

Every time you change code:

```bash
npm run build:reddit
```

Stop and restart playtest if the server changed. If only client files changed (`client.js`, `client.html`), the playtest session picks them up automatically on the next page refresh.

## What `npm run build:reddit` does

The build runs three steps in sequence:

1. **`vite build`** — compiles the kernel HTML to `dist/index.html` (PWA disabled for Reddit since service workers don't work inside the webview iframe)
2. **`node servers/reddit/build.js`** — generates `data-bundle.json` from your `data/` directory, extracts inline scripts from data files into `dist/client/scripts/`, writes a `scripts/manifest.json`, copies the thin client shell to `dist/client/index.html`
3. **`vite build --config servers/reddit/vite.server.config.js`** — bundles the server with `data-bundle.json` baked in, outputs `dist/server/index.cjs`

## Project structure (Reddit-specific files)

```
servers/reddit/
  server.ts              — Devvit server: menu action + /api/run endpoint
  client.html            — Thin client shell (no kernel, no eval)
  client.js              — Client: seeds IndexedDB, calls /api/run, renders HTML
  build.js               — Post-build script (data bundling, script extraction)
  vite.server.config.js  — Vite config for bundling server.ts → dist/server/index.cjs
  data-bundle.json       — Generated at build time, not committed

devvit.json              — Devvit app configuration (name, entrypoints, permissions)
```

## Publishing to a real subreddit

Once you're happy with the app in playtest:

```bash
npm run build:reddit
npx devvit publish
```

`publish` submits your app for Reddit's review queue. Apps must be reviewed before they can be installed on subreddits with more than 200 members. Review typically takes 1–2 business days.

To install on a subreddit you moderate after approval:

```bash
npx devvit install r/your-subreddit
```

## Namespace and data notes

The Reddit build bakes your `data/` directory into the server bundle at build time. The namespaces included are controlled by `QRX_PUBLIC_NAMESPACES` in your `.env` (same as the GitHub Pages build). Only `main` and `cache` are included by default.

Unlike the local server and GitHub Pages deployments, writes on Reddit are currently in-memory only — they persist for the session but reset between app restarts. Redis-backed persistence is a planned future addition.

## Further reading

- [How we worked around Devvit's CSP](./devvit-csp-workarounds.md) — the full story of every constraint we hit and how we got past them
- [Devvit documentation](https://developers.reddit.com/docs)