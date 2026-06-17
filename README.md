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
| **`DB`** | **Database Name**. The name of the active IndexedDB instance, derived from the URL path (e.g., `/private` sets `DB` to `'private'`). |
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

# Developer Notes

## Build Pipeline (`npm run build`)

The build produces a `dist/index.html` in three stages:

1. **Compress** — `html-minifier-terser` strips comments, collapses whitespace, and minifies inline JS/CSS. The result is the bare kernel. Its byte size is printed to the console alongside the QR-L capacity cap (2953 bytes) so you can see headroom at a glance
2. **QR Code** — A QR code is generated from the bare kernel and written to `public/index.qr.png`. This happens before any wrapping so the QR payload is as small as possible
3. **Bootloader injection** — The kernel is wrapped in a full HTML document structure (`<!DOCTYPE html><html><head>…</head><body>…</body></html>`), PWA manifest and service worker registration are injected into `<head>`, and the bootloader script is appended into `<body>`

## What the Bootloader Does

The bootloader runs on every page load, after the kernel has initialized its DB helpers. It:

- Resolves the active namespace from the hostname (falls back to `main`)
- Fetches `data/index.json` — the server-side manifest of all known `namespace/key` paths — and persists it to IndexedDB
- For the current target key and any `boot/` prefixed keys, fetches content from the server and writes it to IndexedDB if it has changed
- Stubs all other known keys as empty strings so they appear in key listings without triggering a full fetch
- Reloads the page on first boot or whenever synced content has changed, so the kernel always starts with a consistent local state

-----

# Tips

## Hotloading System Prompts
System prompts can get massive, making them impossible to pass via standard URL configuration (`?s=You are a...`) without hitting browser parameter length constraints. 

Instead, you can save your system prompt as a standard text file in your database (e.g., under `system`) and use the `?x` (execute) trick to read it from the database and inject it straight into the kernel's local storage:

`?x=read('system').then(v => localStorage.setItem('s', v))`

Because `?x` evaluates dynamically via `new Function` without an `async` wrapper, using the native Promise `.then()` chain successfully prevents top-level `await` syntax errors. This permanently sets your operating system's behavioral framework securely behind the scenes.

