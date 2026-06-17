import { defineConfig, loadEnv } from 'vite'
import { minify } from 'html-minifier-terser'
import QRCode from 'qrcode'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { VitePWA } from 'vite-plugin-pwa'

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
    // Wrap with real document structure so VitePWA's pipeline scan finds <head>
    // and injects manifest + SW registration. writeBundle will read the final
    // dist file which already has these tags, then prepend the QR-safe kernel.
    return `<!DOCTYPE html><html><head></head><body>${minified}</body></html>`
  },
})

/**
 * Post-build plugin that, in strict order:
 *   1. Reads the built index.html (now has full doc structure + PWA injections).
 *   2. Extracts the bare kernel from inside <body> for QR code generation.
 *   3. Generates a QR code from the bare kernel — must be as small as possible.
 *   4. Appends the bootloader into the existing <body>.
 *   5. Writes the final file.
 */
const qrCodePlugin = (base) => ({
  name: 'qr-code-plugin',
  async writeBundle() {
    const filePath = resolve(__dirname, 'dist/index.html')
    const html = readFileSync(filePath, 'utf-8')

    // Extract bare kernel from inside <body> for QR — strip all doc structure
    const kernel = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? html

    // Generate QR from the bare kernel before any bootloader is appended
    const kernelBytes = Buffer.byteLength(kernel, 'utf-8')
    console.log(`\n  QR kernel: ${kernelBytes} bytes (QR-L cap: 2953 bytes, ${2953 - kernelBytes} remaining)\n`)
    await QRCode.toFile(resolve(__dirname, 'public/index.qr.png'), kernel, {
      errorCorrectionLevel: 'L',
      type: 'png',
      width: 1000,
      margin: 1,
    })

    /**
     * Bootloader: runs on every page load after the kernel is ready.
     *
     * Responsibilities:
     *   - Resolves the active namespace from the hostname or falls back to 'main'.
     *   - Fetches data/index.json to get the full list of known keys.
     *   - Syncs the target key (and any boot/ keys) from the server into IndexedDB.
     *   - Stubs out all other known keys as empty strings if not already present.
     *   - Reloads the page on first boot or when any content has changed.
     *
     * Waits for getDB / keys / write to be defined before running,
     * polling every 50ms to handle async kernel initialization.
     */
    const bootloader = `
    <script>

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


          let pathNs = location.pathname.split('/')[1] || await window.NS || 'main';
          let currentHash = location.hash.replace('#', '') || 'main';
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

            if (item === targetItem || item === mainFallbackItem || key.startsWith('boot/')) {

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

          if (isFirstBoot || needsReload) {
            location.reload();
          }
        } catch (e) {
          console.error('[Bootloader] Failed:', e);
        }
      })();
    </script>`

    // Inject bootloader just before </body> in the already-structured HTML
    const final = html.replace('</body>', bootloader.replace(/\s+/g, ' ') + '</body>')
    writeFileSync(filePath, final)
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const baseUrl = process.env.BASE_URL || env.BASE_URL || '/'

  return {
    base: baseUrl,
    plugins: [
      VitePWA({
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
          globIgnores: ['**/404.html'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: baseUrl + 'index.html',
        },
      }),
      htmlMinifierPlugin(),
      qrCodePlugin(baseUrl),
    ],
    build: {
      minify: 'terser',
      terserOptions: { format: { comments: false } },
    },
  }
})
