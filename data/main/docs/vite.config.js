import { defineConfig, loadEnv } from 'vite'
import { minify } from 'html-minifier-terser'
import QRCode from 'qrcode'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { VitePWA } from 'vite-plugin-pwa'

const htmlMinifierPlugin = () => {
  return {
    name: 'html-minifier-plugin',
    enforce: 'post',
    async transformIndexHtml(html) {
      return await minify(html, {
        removeComments: true, collapseWhitespace: true, minifyJS: true, minifyCSS: true,
        removeAttributeQuotes: true, collapseBooleanAttributes: true, processConditionalComments: true, removeOptionalTags: true
      })
    },
  }
}

const qrCodePlugin = (base) => {
  return {
    name: 'qr-code-plugin',
    async writeBundle() {
      const filePath = resolve(__dirname, 'dist/index.html')
      const code = readFileSync(filePath, 'utf-8')

      await QRCode.toFile(resolve(__dirname, 'public/index.qr.png'), code, {
        errorCorrectionLevel: 'L', type: 'png', width: 1000, margin: 1
      })

      const pwaScript = `<link rel="manifest" href="${base}manifest.webmanifest"><script>if('serviceWorker'in navigator)navigator.serviceWorker.register('${base}sw.js')</script>`

      const bootloader = `
      <script>
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

            let pathNs = location.pathname.split('/')[1] || 'main';
            let currentHash = location.hash.replace('#', '') || 'MAIN';
            let targetItem = pathNs + '/' + currentHash;
            let needsReload = false;

            for (let item of list) {
              let parts = item.split('/');
              let ns = parts[0];
              let key = parts.slice(1).join('/'); 
              let targetDB = await getDB(ns);
              
              let targetKeys = await keys(undefined, targetDB);
              let exists = targetKeys.includes(key);
              
              if (item === targetItem || item === 'main/MAIN' || key.startsWith('boot/')) {
                let contentRes = await fetch('${base}data/' + item);
                if (contentRes.ok) {
                  let text = await contentRes.text();
                  let localVal = exists ? await queryDB(tx('readonly', targetDB).get(key)) : null;
                  if (localVal !== text) {
                    await queryDB(tx('readwrite', targetDB).put(text, key));
                    needsReload = true;
                  }
                }
              } else {
                if (!exists) {
                  await queryDB(tx('readwrite', targetDB).put('', key));
                }
              }
            }
            
            if (isFirstBoot || needsReload) {
              location.reload();
            }
          } catch (e) {
            console.error('[Bootloader] Failed:', e);
          }
        })();
      </script>`;

      writeFileSync(filePath, code + pwaScript + bootloader.replace(/\s+/g, ' '));
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const baseUrl = process.env.BASE_URL || env.BASE_URL || '/'

  return {
    base: baseUrl,
    plugins:[
      VitePWA({
        strategies: 'generateSW', registerType: 'autoUpdate', injectRegister: null,
        manifest: {
          name: 'QRx', short_name: 'qrx', description: 'generative quine', display: 'browser', theme_color: '#ffffff',
          icons:[{ src: 'favicon.png', sizes: '192x192', type: 'image/png' }, { src: 'favicon.png', sizes: '512x512', type: 'image/png' }]
        },
        workbox: { globPatterns:['**/*.{js,css,html,ico,png,svg,json}'], globIgnores:['**/404.html'], cleanupOutdatedCaches: true, clientsClaim: true, skipWaiting: true, navigateFallback: baseUrl + 'index.html' }
      }),
      htmlMinifierPlugin(),
      qrCodePlugin(baseUrl)
    ],
    build: { minify: 'terser', terserOptions: { format: { comments: false } } }
  }
})
