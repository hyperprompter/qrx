/**
 * servers/reddit/build.js
 *
 * Post-build step for Reddit Devvit deployment.
 * Mirrors servers/github/build.js closely:
 *   - Reads QRX_PUBLIC_NAMESPACES (plus always-included 'main' and 'cache')
 *   - Copies each allowed namespace from data/ into dist/client/data/
 *   - Generates dist/client/data/index.json (flat key manifest)
 *   - Copies dist/index.html → dist/client/index.html
 *   - Injects a static bootloader (same as GitHub Pages, BASE='')
 *
 * Devvit serves everything in dist/client/ at the root of the webview,
 * so fetch('data/index.json') and fetch('data/ns/key') work identically
 * to how they work on GitHub Pages — just without a BASE subdirectory prefix.
 *
 * Run via: npm run build:reddit
 * (which is: vite build && node servers/reddit/build.js)
 */

import { readdir, copyFile, mkdir, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const DATA_DIR = join(ROOT, 'data')
const DIST = join(ROOT, 'dist')
const DIST_CLIENT = join(DIST, 'client')
const DIST_DATA = join(DIST_CLIENT, 'data')
const INDEX_PATH = join(DIST_DATA, 'index.json')

const IGNORE_LIST = ['.DS_Store', '.git', 'node_modules', '.gitlab-ci.yml']

const includeRaw = process.env.QRX_PUBLIC_NAMESPACES || 'main'
const includeParsed = includeRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const INCLUDE_SET = new Set([...includeParsed, 'main', 'cache'])

console.log(`\n  Reddit (Devvit) build`)
console.log(`  Allowed namespaces: ${[...INCLUDE_SET].join(', ')}\n`)

function fromFsKey(key) {
  return key.replace(/%3A%2F/g, ':/')
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORE_LIST.includes(entry.name)) continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
    }
  }
}

async function walk(dir, base) {
  const results = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORE_LIST.includes(entry.name)) continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      results.push(...await walk(join(dir, entry.name), rel))
    } else {
      results.push(fromFsKey(rel))
    }
  }
  return results
}

/**
 * Static bootloader for Devvit webview.
 * Identical to buildStaticBootloader(base) in vite_config.js with base=''.
 * Devvit serves dist/client/ at the webview root, so no subdirectory prefix needed.
 * Note: injected script uses block comment style only — inline // breaks when HTML is compressed.
 */
function buildRedditBootloader() {
  return `<script>
(async function boot(){
  if(typeof getDB==='undefined'||typeof keys==='undefined'||typeof write==='undefined'){
    return setTimeout(boot,50);
  }
  try{
    let mainDB=await getDB();
    let k=await keys(undefined,mainDB);
    let isFirstBoot=k.length===0;
    if(isFirstBoot&&typeof A!=='undefined') A.innerText='Syncing Dataverse...';
    let res=await fetch('data/index.json');
    if(!res.ok) throw new Error('Could not reach data/index.json');
    let list=await res.json();
    await queryDB(tx('readwrite',mainDB).put(JSON.stringify(list),'index.json'));
    let activeNS=DB;
    let currentHash=location.hash.replace('#','')||'main';
    let targetItem=activeNS+'/'+currentHash;
    let needsReload=false;
    for(let item of list){
      let parts=item.split('/');
      let ns=parts[0];
      let key=parts.slice(1).join('/');
      /* cache namespace is runtime-only — skip */
      if(ns==='cache') continue;
      let targetDB=await getDB(ns);
      let targetKeys=await keys(undefined,targetDB);
      let exists=targetKeys.includes(key);
      if(item===targetItem||key.startsWith('boot/')){
        let contentRes=await fetch('data/'+ns+'/'+key);
        if(contentRes.ok){
          let text=await contentRes.text();
          let localVal=exists?await queryDB(tx('readonly',targetDB).get(key)):null;
          if(localVal!==text){
            await queryDB(tx('readwrite',targetDB).put(text,key));
            needsReload=true;
          }
        }
      } else if(!exists){
        await queryDB(tx('readwrite',targetDB).put('',key));
      }
    }
    if(isFirstBoot||needsReload) location.reload();
  } catch(e){
    console.error('[Bootloader] Failed:',e);
  }
})();
</script>`
}

async function main() {
  await mkdir(DIST_CLIENT, { recursive: true })
  await mkdir(DIST_DATA, { recursive: true })

  /* Copy and index data/ namespaces into dist/client/data/ */
  if (!existsSync(DATA_DIR)) {
    console.log('  No data/ directory found — writing empty index.json\n')
    await writeFile(INDEX_PATH, JSON.stringify([]))
  } else {
    const namespaces = await readdir(DATA_DIR, { withFileTypes: true })
    const indexEntries = []

    for (const ns of namespaces) {
      if (!ns.isDirectory() || IGNORE_LIST.includes(ns.name)) continue
      if (!INCLUDE_SET.has(ns.name.toLowerCase())) {
        console.log(`  Skipping namespace: ${ns.name} (not in allowlist)`)
        continue
      }

      const srcDir = join(DATA_DIR, ns.name)
      const destDir = join(DIST_DATA, ns.name)

      console.log(`  Copying namespace: ${ns.name} → dist/client/data/${ns.name}`)
      await copyDir(srcDir, destDir)

      const keys2 = await walk(srcDir, '')
      for (const key of keys2) {
        indexEntries.push(`${ns.name}/${key}`)
      }
      console.log(`    ${keys2.length} keys indexed`)
    }

    await writeFile(INDEX_PATH, JSON.stringify(indexEntries))
    console.log(`\n  index.json written with ${indexEntries.length} total entries`)
  }

  /* Build a data bundle — all namespace files as a flat JSON map.
   * Bundled into the server at build time so no fs access needed at runtime.
   * Keys are 'ns/key', values are file contents. */
  const bundle = {}

  if (existsSync(DATA_DIR)) {
    const namespaces = await readdir(DATA_DIR, { withFileTypes: true })
    for (const ns of namespaces) {
      if (!ns.isDirectory() || IGNORE_LIST.includes(ns.name)) continue
      if (!INCLUDE_SET.has(ns.name.toLowerCase())) continue
      const nsPath = join(DATA_DIR, ns.name)
      const fileKeys = await walk(nsPath, '')
      for (const key of fileKeys) {
        const filePath = join(nsPath, ...fromFsKey(key).split('/'))
        const content = await readFile(filePath, 'utf-8').catch(() => '')
        bundle[`${ns.name}/${fromFsKey(key)}`] = content
      }
    }
  }

  await writeFile(
    join(__dirname, 'data-bundle.json'),
    JSON.stringify(bundle)
  )
  console.log(`\n  data-bundle.json written with ${Object.keys(bundle).length} entries`)


  /* Extract inline scripts from data files into static .js files.
   * Scripts served statically need no auth — satisfies CSP script-src 'self'. */
  const scriptsDir = join(DIST_CLIENT, 'scripts')
  await mkdir(scriptsDir, { recursive: true })
  const manifest = {}
  const scriptRe = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g
  for (const [key, html] of Object.entries(bundle)) {
    const scripts = []
    let match, si = 0
    scriptRe.lastIndex = 0
    while ((match = scriptRe.exec(html)) !== null) {
      const code = match[1].trim()
      if (!code) continue
      const safeName = key.replace(/[^a-z0-9]/gi, '-')
      const filename = 'scripts/' + safeName + '-' + si++ + '.js'
      await writeFile(join(DIST_CLIENT, filename), code)
      scripts.push(filename)
    }
    if (scripts.length) manifest[key] = scripts
  }
  await writeFile(join(DIST_CLIENT, 'scripts/manifest.json'), JSON.stringify(manifest))
  console.log('  scripts/manifest.json written with ' + Object.keys(manifest).length + ' keys')


  /* Copy thin client shell — replaces the kernel for Reddit. */
  await copyFile(join(__dirname, 'client.html'), join(DIST_CLIENT, 'index.html'))
  await copyFile(join(__dirname, 'client.js'), join(DIST_CLIENT, 'client.js'))

  /* Create /main/ etc so iframe paths like /main#bundle resolve correctly. */
  const knownNs = [...new Set(Object.keys(bundle).map(k => k.split('/')[0]).filter(n => n !== 'cache'))]
  for (const ns of knownNs) {
    const src = await readFile(join(DIST_CLIENT, 'index.html'), 'utf-8')
    await writeFile(join(DIST_CLIENT, ns), src)
    console.log('  dist/client/' + ns + ' written (clone)')
  }

  console.log(`\n  Ready for: devvit playtest r/YOUR_SUBREDDIT\n`)
}

main().catch(err => {
  console.error('build:reddit failed:', err)
  process.exit(1)
})