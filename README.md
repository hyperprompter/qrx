<div align=center>
  <div><img alt="Q for QRx" src="./public/favicon.png" width=96></div>
  <h1>Generative QR Coding (QRx)</h1>
  <p>Kernel 26.06.14</p>
  <div><img alt="QR Code for QRx Kernel 26.02.15" src="./public/index.qr.png" width=400></div>
</div>
<br>

This qr encodes an html file turning any browser since the 1990s into an offline-first generative REPL to prompt and vibe code. It does this by reimagining the browser's local storage as a file system composed from hyperlinks that functions as a prompt chaining interface 

-----------------------------

# Core flags
The above Kernel exposes the following URL `?query` params

| Flag | Description |
| :--- | :--- |
| **`a`** | **Append Mode**. If `1`, subsequent commands append to the accumulator. If `0` (default), they overwrite it. |
| **`f`** | **File Pointer**. Sets the target filename (`filename`) for subsequent write (`w`) operations. |
| **`c`** | **Context**. Loads data (from DB or `src`) into a side-buffer for the AI, without affecting the main accumulator. `0` clears it. |
| **`k, m, s, h`** | **AI Config**. Sets the API Key (`k`), Model (`m`), System Prompt (`s`), or Host (`h`) in `localStorage`. |
| **`e`** | **Echo**. Pushes the raw value directly into the accumulator (hardcoded strings/HTML). |
| **`r`** | **Read**. Reads a file from the database (or `src` for source code) into the accumulator. |
| **`u`** | **URL**. Fetches text from a remote URL. Implements a **Network-First, Cache-Fallback** mechanism. Successful fetches are passively synced to a discrete `'cache'` IndexedDB namespace. If your OS is offline, it automatically catches the failure and serves the file locally. |
| **`p`** | **Prompt**. Sends the current context + accumulator + value to the LLM. The result becomes the new accumulator. |
| **`w`** | **Write**. Saves the current accumulator content to the database under the name defined by `f`. |
| **`x`** | **Execute**. Runs the value (or the current accumulator if value is empty) as JavaScript. |

# Globals
The kernel exposes the following variables and methods

## Variables
| Variable | Description |
| :--- | :--- |
| **`filename`** | **File Pointer**. The name of the current record being read from or written to. Defaults to `MAIN` or the value before `?` in the hash. |
| **`BASE`** | **Deployment Prefix**. A path segment stripped from the front of the URL before `DB` is derived. Defaults to `''` (root hosting). Set it by declaring `BASE='/yourprefix'` in a `<script>` tag placed *after* `<script id=S>` (the kernel's own line runs first and would otherwise be overwritten). Lets the same kernel resolve namespaces correctly whether it's hosted at `/` or under a subdirectory like `/qrx/`. |
| **`DB`** | **Database Name**. The name of the active IndexedDB instance, derived from the URL path with `BASE` and any leading/trailing slashes stripped (e.g. `/qrx/wiki` with `BASE='/qrx/'` sets `DB` to `'wiki'`). |
| **`MAIN`** | **Kernel Name**. The default database name (`'main'`). Used as the fallback/system database when `DB` is set to something else. |
| **`os`** | **System DB Handle**. A reference to the `MAIN` database connection. Used for "inheritance"—if a file isn't found in `DB`, `read()` looks here. |
| **`db`** | **Active DB Handle**. The raw `IDBDatabase` connection object for the current `DB`. |
| **`FILES`** | **Table Name**. The hardcoded name of the object store (`'files'`) within the IndexedDB where all records are saved. |

## Methods
| Method | Description |
| :--- | :--- |
| **`read(k, [d])`** | **Async Read**. Returns the content of file `k`. Checks the current database first, then falls back to the `os` database if the file exists there |
| **`write(v, [k])`** | **Async Write**. Saves value `v` to file `k`. If `k` is omitted, it defaults to the current `filename` pointer |
| **`hydrate(h)`** | **Render**. Injects HTML string `h` into the main DOM (`<main id=A>`) and recursively executes any embedded `<script>` tags |
| **`gen(ctx, p)`** | **Vibe Code**. Sends the context buffer `ctx` and prompt `p` to the configured LLM API and returns the generated text |
| **`keys([q], [d])`** | **List Files**. Returns an array of all keys (filenames) in the database. `q` is an optional `IDBKeyRange` |
| **`getDB([n])`** | **Database Access**. Returns the IndexedDB instance for name `n`. Defaults to the current active database |
| **`run()`** | **Re-Run Tape**. Manually triggers the URL parsing loop. Useful if hash state changes programmatically without a reload |

-----------------------------

# Developer Notes

## Build Pipeline (`npm run build`)

The build produces a `dist/index.html` in three stages:

1. **Compress** — `html-minifier-terser` strips comments, collapses whitespace, and minifies inline JS/CSS. The result is the bare kernel. Its byte size is printed to the console alongside the QR-L capacity cap (2953 bytes) so you can see headroom at a glance
2. **QR Code** — A QR code is generated from the bare kernel and written to `public/index.qr.png`. This happens before any wrapping so the QR payload is as small as possible
3. **Bootloader injection** — The kernel is wrapped in a full HTML document structure (`<!DOCTYPE html><html><head>…</head><body>…</body></html>`), PWA manifest and service worker registration are injected into `<head>`, and the bootloader script is appended into `<body>`

### Static Deploys (GitHub Pages, etc.)

`npm run build:github` mirrors `server.js`'s namespace logic at build time instead of runtime — it reads `QRX_PUBLIC_NAMESPACES` and copies only the allowed namespaces from `data/` into `public/data/`, then generates a static `public/data/index.json`.

This means `QRX_PUBLIC_NAMESPACES` currently has to be set in **two places** and kept in sync manually:

- **`.env`** — controls what your live `server.js` instance serves publicly
- **`deploy.yml`** (`QRX_PUBLIC_NAMESPACES` under the `Build for GitHub Pages` step) — controls what gets baked into the static GitHub Pages build

If you add a namespace and only update `.env`, your server will serve it but your static GitHub Pages deploy won't — it'll silently fall back to whatever was last baked in. There's no automated sync between the two yet, so for now, **remember to update `deploy.yml` whenever you change `QRX_PUBLIC_NAMESPACES` in `.env`**, especially if you want the static deploy to match your server's namespace visibility.

#### Subdirectory Hosting (`BASE_URL`)

GitHub Pages project sites are served from a subdirectory (e.g. `https://you.github.io/qrx/`), not root. `deploy.yml` already sets this via the `BASE_URL` env var on the `Build for GitHub Pages` step — it's used both for Vite's own asset paths and to set the kernel's `BASE` variable, so namespace resolution works the same under a subdirectory as it does at root. You shouldn't need to touch this unless your repo name (and therefore your Pages path) changes — if so, update `BASE_URL` in `deploy.yml` to match.

`.env` is never read during the GitHub Actions build (it's not committed to the repo), so this kind of build-time config always belongs in `deploy.yml`'s `env:` block, not `.env` — same reasoning as the `QRX_PUBLIC_NAMESPACES` duplication above.

#### Why GitHub Pages Needs a `404.html`

GitHub Pages only serves real files. A URL like `/qrx/wiki` has no matching file on disk, so GitHub Pages returns its `404.html` for it instead of an error page — this build generates one automatically that:

1. Saves the real path (e.g. `/qrx/wiki`) into `sessionStorage`
2. Redirects to the site root, carrying the hash through directly (hashes survive a redirect for free; the path doesn't, since it's a different document)
3. Once `index.html` loads, a small injected script restores the real path via `history.replaceState` before the kernel reads it — so by the time the kernel runs, it sees `/qrx/wiki` exactly as if that URL had loaded directly

This makes deep links and page refreshes work normally on GitHub Pages despite there being no actual server-side routing.

## What the Bootloader Does

The bootloader runs on every page load, after the kernel has initialized its DB helpers. It:

- Resolves the active namespace from the hostname (falls back to `main`)
- Fetches `data/index.json` — the server-side manifest of all known `namespace/key` paths — and persists it to IndexedDB
- For the current target key and any `boot/` prefixed keys, fetches content from the server and writes it to IndexedDB if it has changed
- Stubs all other known keys as empty strings so they appear in key listings without triggering a full fetch
- Reloads the page on first boot or whenever synced content has changed, so the kernel always starts with a consistent local state

-----------------------------

# Server

## Setup

Rename `TEMPLATE.env` to `.env` before starting the server:

```
cp TEMPLATE.env .env
```

Then edit `.env` to configure your instance:

```
# Secret key required to authorize /write requests
QRX_SYNC_KEY=your-secret-here

# Comma-separated list of namespaces publicly readable via /read
# 'main' and 'cache' are always included regardless of this setting
QRX_PUBLIC_NAMESPACES=main,wiki,cache

# Port the server listens on
QRX_PORT=3000
```

`QRX_SYNC_KEY` acts as a shared secret between your kernel and the server. Any `?w=` write that persists to disk sends this key in the `Authorization` header — without it, `/write` returns 401. Keep it out of version control.

## Running

```
npm run build   # compile kernel + generate QR
npm run start   # start the server
```

The server will log:

```
Server active on http://0.0.0.0:3000
```

In development you can run `npm run start` without building first if `dist/` already exists. The two processes are independent.

## Namespaces

All data is organized into namespaces — each one maps to a directory under `data/`. The active namespace for a given browser session is determined by:

1. The URL path segment: `http://yourhost/wiki` sets `DB` to `wiki`
2. The hostname: if `data/yourhostname/` exists, `window.NS` is injected into the served HTML and the kernel uses it as the active namespace
3. Fallback: `main`

Namespaces that aren't in `QRX_PUBLIC_NAMESPACES` (plus the always-included `main` and `cache`) are private — `/read` will return 404 for them unless the request carries a valid `QRX_SYNC_KEY`. This lets you host multiple users or contexts from one server with controlled visibility.

The `main` namespace acts as a system-level fallback: if a key isn't found in the active namespace, `/read` tries `data/main/` before giving up.

## data/index.json

`data/index.json` is a flat JSON array of every publicly readable `namespace/key` path the server knows about, e.g.:

```json
["main/boot/init", "main/readme", "wiki/start", "cache/https://example.com/feed"]
```

It is regenerated automatically in two situations:

- On server startup
- When a file change is detected in `data/` (debounced 30 seconds to avoid thrashing on rapid writes)

The bootloader fetches this file on every page load to know what keys exist without having to enumerate IndexedDB. Keys not present in the index don't get synced from the server, even if they exist locally.

URL-style keys (e.g. from `?u=` fetches) are stored on disk with `://` encoded as `%3A%2F` to avoid `path.join` collapsing the double slash. The index always contains the decoded original key so the kernel never sees the encoded form.

## URL Caching (`?u=`)

When the kernel fetches a URL via `?u=https://...`, it uses a network-first, cache-fallback strategy:

1. Fetches the URL over the network
2. On success, writes the content to the `cache` IndexedDB namespace under the URL as the key
3. On failure (offline, timeout, error), reads from `cache` instead

The `cache` namespace is always publicly readable — its contents were already public by definition since they came from external URLs. This means cached remote content survives across sessions and devices that share the same server.

## Server-Sent Events (`/stream`)

The server exposes a `/stream` endpoint that pushes real-time write notifications to connected clients via SSE. Whenever a `/write` succeeds, all connected clients receive a JSON event:

```json
{ "namespace": "main", "key": "myfile", "clientId": "..." }
```

This allows multiple browser tabs or devices to react to writes without polling. The kernel can subscribe to `/stream` and call `run()` or selectively reload keys when it receives a relevant event.

If `QRX_SYNC_KEY` is set, `/stream` requires `?auth=your-secret` in the URL to connect.

## PWA

QRx registers as a Progressive Web App on first load. The service worker (generated by VitePWA/Workbox) caches all static assets — JS, CSS, HTML, icons, and JSON — so the kernel loads instantly offline after the first visit. It uses `skipWaiting` and `clientsClaim` so updates propagate to all tabs immediately without a manual refresh cycle.

The PWA manifest and SW registration script are injected into `<head>` during the build's bootloader injection step rather than by VitePWA's normal pipeline, because the kernel HTML has no document structure until that final wrap. The QR code is generated before this step so the PWA overhead doesn't count against the 2953 byte QR-L cap.


-----------------------------

# Tips

## Hotloading System Prompts
System prompts can get massive, making them impossible to pass via standard URL configuration (`?s=You are a...`) without hitting browser parameter length constraints. 

Instead, you can save your system prompt as a standard text file in your database (e.g., under `system`) and use the `?x` (execute) trick to read it from the database and inject it straight into the kernel's local storage:

`?x=read('system').then(v => localStorage.setItem('s', v))`

Because `?x` evaluates dynamically via `new Function` without an `async` wrapper, using the native Promise `.then()` chain successfully prevents top-level `await` syntax errors. This permanently sets your operating system's behavioral framework securely behind the scenes.
