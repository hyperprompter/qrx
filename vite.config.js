import { defineConfig, loadEnv } from 'vite'
import { minify } from 'html-minifier-terser'
import QRCode from 'qrcode'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = resolve()

const jsString = value => JSON.stringify(value).replace(/</g, '\\u003c')

/**
 * Minifies the final index.html after all transforms.
 * Also prepends a minimal <head> stub so VitePWA can find it during its
 * pipeline scan — without this, VitePWA warns and skips SW/manifest injection
 * because the kernel HTML has no document structure. The stub is stripped back
 * out by writeBundle after the QR code is generated.
 */
const htmlMinifierPlugin = () => ({
  name: 'html-minifier-plugin',
  enforce: 'post',
  async transformIndexHtml(html) {
    const minified = await minify(html, {
      removeComments: true,
      collapseWhitespace: true,
      minifyJS: true,
      minifyCSS: true,
      removeAttributeQuotes: true,
      collapseBooleanAttributes: true,
      processConditionalComments: true,
      removeOptionalTags: true,
    })
    return `<!DOCTYPE html><html><head></head><body>${minified}</body></html>`
  },
})

/**
 * Builds the bootloader script for server deployments.
 *
 * Resolves namespace from hostname, fetches data/index.json, then for each
 * known key either syncs content via POST /read (for target/query/boot keys)
 * or stubs empty strings. Reloads on first boot or when content has changed.
 */
function buildServerBootloader(base) {
  return `
    <script>
      var qrxBootHash = location.hash;

      window.NS = fetch('${base}data/index.json')
        .then(r => r.ok ? r.json() : [])
        .then(list => {
          let h = location.hostname;
          return (h && list.some(i => i.startsWith(h + "/"))) ? h : 'main';
        })
        .catch(() => 'main');

      (async function boot() {

        if (typeof getDB === 'undefined' || typeof keys === 'undefined' || typeof write === 'undefined') {
          return setTimeout(boot, 50);
        }

        try {
          let mainDB = await getDB();
          let k = await keys(undefined, mainDB);
          let isFirstBoot = k.length === 0;

          if (isFirstBoot && typeof A !== 'undefined') A.innerText = 'Syncing Dataverse...';


          let res = await fetch('${base}data/index.json');
          if (!res.ok) throw new Error('Could not reach data/index.json');
          let list = await res.json();


          await queryDB(tx('readwrite', mainDB).put(JSON.stringify(list), 'index.json'));


          let pathNs = DB;
          let bootHash = qrxBootHash.slice(1);
          let currentHash = bootHash.split('?')[0] || 'main';
          let queryKeys = [...new URLSearchParams(bootHash.split('?')[1] || '').keys()];
          let targetItem = pathNs + '/' + currentHash;
          let mainFallbackItem = 'main/' + currentHash;
          let needsReload = false;

          for (let item of list) {
            let parts = item.split('/');
            let ns = parts[0];
            let key = parts.slice(1).join('/');
            let targetDB = await getDB(ns);

            let targetKeys = await keys(undefined, targetDB);
            let exists = targetKeys.includes(key);

            if (item === targetItem || item === mainFallbackItem || queryKeys.includes(key) || key.startsWith('boot/')) {

              let contentRes = await fetch('${base}read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ namespace: ns, key: key }),
              });
              if (contentRes.ok) {
                let data = await contentRes.json();
                let text = data.value !== undefined ? data.value : '';
                let localVal = exists ? await queryDB(tx('readonly', targetDB).get(key)) : null;

                if (localVal !== text) {
                  await queryDB(tx('readwrite', targetDB).put(text, key));
                  needsReload = true;
                }
              }
            } else if (!exists) {

              await queryDB(tx('readwrite', targetDB).put('', key));
            }
          }

          /* fetch private index using SYNC_KEY from localStorage — only runs if visitor has the key set */
          try {
            let syncKey = localStorage.getItem('SYNC_KEY');
            if (syncKey) {
              let privRes = await fetch('${base}data/index.private.json', {
                headers: { 'Authorization': syncKey },
              });
              if (privRes.ok) {
                let privList = await privRes.json();
                for (let item of privList) {
                  let parts = item.split('/');
                  let ns = parts[0];
                  let key = parts.slice(1).join('/');
                  let targetDB = await getDB(ns);
                  let targetKeys = await keys(undefined, targetDB);
                  let exists = targetKeys.includes(key);
                  if (item === targetItem || item === mainFallbackItem || queryKeys.includes(key) || key.startsWith('boot/')) {
                    let contentRes = await fetch('${base}read', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': syncKey },
                      body: JSON.stringify({ namespace: ns, key: key }),
                    });
                    if (contentRes.ok) {
                      let data = await contentRes.json();
                      let text = data.value !== undefined ? data.value : '';
                      let localVal = exists ? await queryDB(tx('readonly', targetDB).get(key)) : null;
                      if (localVal !== text) {
                        await queryDB(tx('readwrite', targetDB).put(text, key));
                        needsReload = true;
                      }
                    }
                  } else if (!exists) {
                    await queryDB(tx('readwrite', targetDB).put('', key));
                  }
                }
              }
            }
          } catch (e) { console.warn('[Bootloader] Private index unavailable:', e); }

          if (isFirstBoot || needsReload) {
            if (qrxBootHash && location.hash !== qrxBootHash) {
              history.replaceState(null, '', qrxBootHash);
            }
            location.reload();
          }
        } catch (e) {
          console.error('[Bootloader] Failed:', e);
        }
      })();
    </script>`
}

/**
 * Builds the bootloader script for GitHub Pages (static) deployments.
 *
 * Key differences from the server bootloader:
 *   - Skips the 'cache' namespace entirely — cache keys are URL-derived and
 *     not meaningful as static files; the ?u= fetch path handles caching at
 *     runtime via IndexedDB anyway, and on GitHub Pages you're always online.
 *   - Replaces POST /read with a plain GET to the static file path:
 *     fetch(`${base}data/${ns}/${key}`) instead of fetch('${base}read', { method: 'POST', ... })
 *   - No hostname-based NS resolution (server.js injects window.NS at serve
 *     time; that doesn't exist on static hosting, so we just fall back to 'main').
 */
function buildStaticBootloader(base) {
  return `
    <script>
      var qrxBootHash = location.hash;

      (async function boot() {

        if (typeof getDB === 'undefined' || typeof keys === 'undefined' || typeof write === 'undefined') {
          return setTimeout(boot, 50);
        }

        try {
          let mainDB = await getDB();
          let k = await keys(undefined, mainDB);
          let isFirstBoot = k.length === 0;

          if (isFirstBoot && typeof A !== 'undefined') A.innerText = 'Syncing Dataverse...';


          let res = await fetch('${base}data/index.json');
          if (!res.ok) throw new Error('Could not reach data/index.json');
          let list = await res.json();


          await queryDB(tx('readwrite', mainDB).put(JSON.stringify(list), 'index.json'));


          let activeNS = DB;
          let bootHash = qrxBootHash.slice(1);
          let currentHash = bootHash.split('?')[0] || 'main';
          let queryKeys = [...new URLSearchParams(bootHash.split('?')[1] || '').keys()];
          let targetItem = activeNS + '/' + currentHash;
          let needsReload = false;

          for (let item of list) {
            let parts = item.split('/');
            let ns = parts[0];
            let key = parts.slice(1).join('/');

            /**
             * Cache namespace is runtime-only on static hosting — skip entirely.
             * The ?u= fetch path writes to IndexedDB directly at runtime.
             */
            if (ns === 'cache') continue;

            let targetDB = await getDB(ns);
            let targetKeys = await keys(undefined, targetDB);
            let exists = targetKeys.includes(key);

            if (item === targetItem || queryKeys.includes(key) || key.startsWith('boot/')) {

              /**
               * Static GET instead of POST /read
               */
              let contentRes = await fetch('${base}data/' + ns + '/' + key);
              if (contentRes.ok) {
                let text = await contentRes.text();
                let localVal = exists ? await queryDB(tx('readonly', targetDB).get(key)) : null;

                if (localVal !== text) {
                  await queryDB(tx('readwrite', targetDB).put(text, key));
                  needsReload = true;
                }
              }
            } else if (!exists) {

              await queryDB(tx('readwrite', targetDB).put('', key));
            }
          }

          if (isFirstBoot || needsReload) {
            if (qrxBootHash && location.hash !== qrxBootHash) {
              history.replaceState(null, '', qrxBootHash);
            }
            location.reload();
          }
        } catch (e) {
          console.error('[Bootloader] Failed:', e);
        }
      })();
    </script>`
}

/**
 * Post-build plugin that, in strict order:
 *   1. Reads the built index.html (now has full doc structure + PWA injections).
 *   2. Extracts the bare kernel from inside <body> for QR code generation.
 *   3. Generates a QR code from the bare kernel — must be as small as possible.
 *   4. Appends the QRX_URL injection and appropriate bootloader into the
 *      existing <body>, chosen based on whether GITHUB_PAGES env var is set.
 *   5. Writes the final file.
 */
const qrCodePlugin = (base, isGitHubPages, qrxUrl) => ({
  name: 'qr-code-plugin',
  async writeBundle() {
    const filePath = resolve(__dirname, 'dist/index.html')
    const html = readFileSync(filePath, 'utf-8')

    const kernel = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? html

    const kernelBytes = Buffer.byteLength(kernel, 'utf-8')
    console.log(`\n  QR kernel: ${kernelBytes} bytes (QR-L cap: 2953 bytes, ${2953 - kernelBytes} remaining)\n`)
    await QRCode.toFile(resolve(__dirname, 'public/index.qr.png'), kernel, {
      errorCorrectionLevel: 'L',
      type: 'png',
      width: 1000,
      margin: 1,
    })

    const baseInject = isGitHubPages ? `<script>
      BASE='${base}';
      (function(){
        var p = sessionStorage.getItem('qrx_path');
        if (!p) return;
        sessionStorage.removeItem('qrx_path');
        history.replaceState(null, '', p + location.hash);
      })();
    </script>` : ''

    const qrxUrlInject = `<script>window.QRX_URL=${jsString(qrxUrl)};</script>`

    const bootloader = isGitHubPages
      ? buildStaticBootloader(base)
      : buildServerBootloader(base)

    const final = html.replace('</body>', baseInject + qrxUrlInject + bootloader.replace(/\s+/g, ' ') + '</body>')
    writeFileSync(filePath, final)

    // GitHub Pages SPA routing: GitHub Pages 404s any path that isn't a real
    // file (e.g. /qrx/wiki). 404.html stashes the real pathname in
    // sessionStorage and redirects to bare base, carrying the hash through
    // directly on the redirect URL (hash survives a redirect for free).
    // baseInject (runs after the kernel's BASE='' line but before its
    // setTimeout body executes) sets BASE and restores the real pathname via
    // replaceState, so by the time the kernel reads LP, it's identical to a
    // normal direct load — the kernel's own BASE-stripping in DB derivation
    // handles the rest unmodified.
    if (isGitHubPages) {
      const notFoundHtml = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<script>
  sessionStorage.setItem('qrx_path', location.pathname);
  location.replace('${base}' + location.hash);
<\/script>
</head><body></body></html>`
      writeFileSync(resolve(__dirname, 'dist/404.html'), notFoundHtml)
      console.log('  404.html written for GitHub Pages SPA routing\n')
    }
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const baseUrl = process.env.BASE_URL || env.BASE_URL || '/'
  const qrxUrl = process.env.QRX_URL || env.QRX_URL || ''
  const isGitHubPages = process.env.GITHUB_PAGES === 'true'
  const isReddit = process.env.REDDIT_BUILD === 'true'

  if (isGitHubPages) {
    console.log('\n  Building for GitHub Pages (static bootloader)\n')
  }
  if (isReddit) {
    console.log('\n  Building for Reddit (PWA disabled)\n')
  }

  return {
    base: baseUrl,
    plugins: [
      /* PWA is disabled for Reddit — service workers do not work inside Devvit webview iframes */
      ...(isReddit ? [] : [VitePWA({
        strategies: 'generateSW',
        registerType: 'autoUpdate',
        injectRegister: null,
        manifest: {
          name: 'QRx',
          short_name: 'qrx',
          description: 'generative quine',
          display: 'browser',
          theme_color: '#ffffff',
          icons: [
            { src: 'favicon.png', sizes: '192x192', type: 'image/png' },
            { src: 'favicon.png', sizes: '512x512', type: 'image/png' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
          globIgnores: [],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: baseUrl + 'index.html',
        },
      }),
      ]),
      htmlMinifierPlugin(),
      qrCodePlugin(baseUrl, isGitHubPages, qrxUrl),
    ],
    build: {
      minify: 'terser',
      terserOptions: { format: { comments: false } },
    },
  }
})
