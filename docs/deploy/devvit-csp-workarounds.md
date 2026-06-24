# How to Run a Dynamic JavaScript Runtime Inside a Reddit Devvit Webview

Reddit's Devvit platform is genuinely impressive — it lets you ship interactive apps that live inside Reddit posts, with a Node.js backend, Redis, and a full webview. But if you're trying to run anything that resembles a dynamic code execution environment, you're going to hit a wall. A very specific, very stubborn wall made of Content Security Policy headers.

This is a writeup of every obstacle we hit and how we got past them, roughly in the order they appeared.

---

## The Environment

Devvit apps have two parts: a **server** (Node.js, Express or Hono, runs on Reddit's infrastructure) and a **client** (static HTML/JS/CSS, served from your `dist/client/` directory in an iframe inside a Reddit post). The client and server communicate via `fetch()` calls to `/api/*` endpoints.

The client iframe has a Content Security Policy imposed by Reddit at the HTTP header level:

```
script-src 'self' webview.devvit.net webview-dev.devvit.net 'wasm-unsafe-eval'
frame-src 'self' *.reddit.com
```

You do not control this header. It cannot be overridden by a `<meta>` tag. It applies to all child frames too.

---

## Problem 1: Inline scripts are blocked

**CSP violation:** `unsafe-inline` is not in `script-src`.

Any `<script>` tag with inline content in your HTML is silently blocked. This includes scripts injected via `innerHTML` — setting `element.innerHTML = '<script>...</script>'` does nothing.

**Solution:** Extract every inline script from your HTML at build time and write it as a separate `.js` file in `dist/client/`. Reference it with `<script src="filename.js">`. Static files served from your own origin satisfy `script-src 'self'`.

This means your build process needs to parse your HTML, pull out `<script>` blocks, write them as numbered files (`page-0.js`, `page-1.js`, etc.), and replace the inline tags with `src` references. Libraries like `node-html-parser` or a simple regex over known-safe content work fine for this.

---

## Problem 2: `eval()` and `new Function()` are blocked

**CSP violation:** `unsafe-eval` is not in `script-src`.

Even with scripts externalised, any call to `eval()`, `new Function()`, or `setTimeout(string)` is blocked. This kills any runtime that executes stored code strings — interpreters, REPLs, template engines that compile to JS, anything.

`'wasm-unsafe-eval'` is in the policy, but that only allows WebAssembly compilation — not JavaScript string evaluation. JavaScript engines compiled to WASM (QuickJS, Duktape) also cannot touch the real DOM, making them useless for UI work.

**Solution:** Move code execution to the server. The Node.js server has no CSP. It can run `vm.runInNewContext()` freely. The client sends the code (or a reference to stored code) to a `/api/run` endpoint, the server executes it, and returns the resulting HTML string. The client just sets `element.innerHTML` — no eval required.

This is a meaningful architectural shift: the client becomes a thin renderer, and all logic lives on the server. For apps where the "program" is stored data rather than bundled code, this works well.

---

## Problem 3: `<script src>` tags from dynamic content get a 401

When the server returns HTML containing `<script src="/api/something">` tags, the browser makes a GET request to load them. But `<script src>` tags don't send auth headers — and Devvit requires its own auth token on every server request. Result: 401.

**Attempted solution:** A token-based endpoint where the client first POSTs the code to `/api/register-script`, gets a short-lived token, then loads `<script src="/api/script/TOKEN">`. The token-based request also got a 401 — same problem.

**Actual solution:** Don't use `<script src>` for dynamic content at all. Since the server already executes the code and returns HTML, the scripts that need to run client-side (those that touch the DOM) are extracted at build time into static files and served from `dist/client/scripts/`. A manifest JSON maps page keys to their associated script files. After rendering, the client loads the right scripts by looking up the manifest.

Static files need no auth token — they're served by Reddit's CDN directly from your build output.

---

## Problem 4: `srcdoc` iframes inherit the parent CSP

Wrapping the entire app in an `<iframe srcdoc="...">` and putting a permissive `<meta http-equiv="Content-Security-Policy">` inside it doesn't work. The HTTP header CSP from the parent always takes precedence over any meta tag, and `srcdoc` iframes inherit the parent's policy.

**Attempted solution:** Blob URL iframes (`URL.createObjectURL`). Blob URL documents don't inherit parent CSP... except `frame-src 'self' *.reddit.com` blocks blob URLs in iframes explicitly.

**Actual solution:** There is no iframe escape hatch. Abandon the iframe wrapper approach entirely and solve the CSP constraints directly as described above.

---

## Problem 5: Boot scripts fail on the server with `window is not defined`

When running stored scripts server-side via `vm.runInNewContext()`, any script that references browser globals (`window`, `document`, `localStorage`, `navigator`, `BroadcastChannel`) throws immediately.

**Wrong solution:** Passing stubs for every browser global to the vm context. Boot scripts are browser-specific — they set up event listeners, manipulate the DOM, register keyboard shortcuts. Running them server-side produces nothing useful even if the globals are stubbed.

**Right solution:** Don't run boot scripts on the server. Boot scripts are extracted to static `.js` files at build time (same as page scripts) and loaded client-side after the server returns the page HTML. The server only executes scripts that compute and return values — not scripts with DOM side effects.

---

## Problem 6: IndexedDB is empty — stored data isn't available

The app used IndexedDB as its primary storage. On other platforms (local, GitHub Pages) a bootloader seeds IndexedDB from static data files on first load. On Reddit, no bootloader runs, so IndexedDB is empty and any script that reads from it finds nothing.

**Solution:** Implement the bootloader logic in the client shell. On first run:

1. Fetch the data manifest (a JSON index of all known keys)
2. For each namespace, open IndexedDB
3. For keys corresponding to boot files or the current page, fetch the actual content from the static data files in `dist/client/data/`
4. For all other keys, write an empty string as a placeholder so scripts know the key exists
5. Store the full key index in IndexedDB so scripts can enumerate files

This mirrors exactly what the bootloader does on static hosting, just implemented in plain JS without the kernel's helper functions.

---

## Problem 7: Iframes created by stored scripts navigate to URLs that 404

The app opens "windows" by creating iframes and setting their `src` to paths like `/main#pagename`. Devvit's static server has no file at `/main` — only `index.html` at the root — so every iframe 404s.

**Attempted solutions:**

- Writing a file named `main` (no extension) to `dist/client/` — served with wrong MIME type, browser refuses to render it
- Writing `dist/client/main/index.html` — 404 because the request is for `/main` not `/main/`
- Overriding `HTMLIFrameElement.prototype.src` — the descriptor may not exist as an own property on the prototype in all browsers

**Working solution:** Override `document.createElement` to intercept every new iframe at creation time. When `iframe.src` is set to a local path, don't navigate the iframe at all — instead wait for the iframe to be attached to the DOM, call `/api/run` from the main frame (which has auth), get the HTML back, and write it directly into the iframe's document via `doc.open()` / `doc.write()` / `doc.close()`.

This sidesteps the auth problem entirely (the fetch happens from the authenticated main frame), the navigation problem (the iframe never leaves `about:blank`), and the CSP problem (no dynamic scripts execute in the iframe).

---

## The Final Architecture

```
Client (dist/client/index.html)
  └── client.js
        ├── Overrides document.createElement for iframes
        ├── Seeds IndexedDB from static data files on first load
        ├── On hash change: POST /api/run → get HTML → innerHTML
        ├── Loads static pre-extracted .js files from /scripts/
        └── For iframes: intercepts src, calls /api/run, doc.write()

Server (dist/server/index.cjs)
  ├── POST /api/run — executes machine tape via vm.runInNewContext()
  │     reads from bundled data-bundle.json (baked in at build time)
  └── POST /internal/menu/create-post — creates the Reddit post

Build (servers/reddit/build.js)
  ├── Generates data-bundle.json from data/ directory
  ├── Extracts inline scripts from every data file → /scripts/ns-key-N.js
  ├── Writes scripts/manifest.json mapping keys to script files
  └── Copies thin client shell to dist/client/
```

The key insight is that **the server is the kernel**. The client is just a fetch-and-render loop. Reddit's CSP restrictions only apply to the browser context — the Node.js server is unconstrained, can run arbitrary code, and returns plain HTML that the client renders safely.

---

## What Still Doesn't Work

- Scripts inside iframes that try to call back to the parent frame's context (cross-frame postMessage works, direct property access doesn't)
- Any client-side code that tries to `eval()` or `new Function()` — this remains blocked, so purely client-side dynamic execution is still impossible
- External fetch from the client — Devvit only allows client-side fetch to your own server's `/api/` endpoints

These are genuine platform constraints, not bugs. The workarounds above get you surprisingly far within them.