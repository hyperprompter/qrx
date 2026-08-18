/**
 * servers/reddit/build.js
 *
 * Post-build step for Reddit Devvit deployment.
 *   - Reads QRX_PUBLIC_NAMESPACES (plus always-included 'main' and 'cache')
 *   - Copies each allowed namespace from data/ into dist/client/data/
 *   - Generates dist/client/data/index.json (flat key manifest)
 *   - Builds data-bundle.json for the server bundle (no fs at runtime)
 *   - Extracts inline <script> blocks from HTML data files into static .js
 *     files (CSP script-src 'self' — inline scripts never run in the webview)
 *   - Wraps raw-JS data files (windows, boot/*, ...) as static kernel modules
 *     — a build-time new Function(G,'v','arg') — so the webview can invoke
 *     them with zero runtime eval
 *   - Copies thin client shell (client.html/client.js) as index.html
 *
 * Run via: npm run build:reddit
 */

import { readdir, copyFile, mkdir, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import vm from 'vm'

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
 * Does this data file parse as a classic script body inside a function?
 * Mirrors the kernel's new Function(G,'v','arg',code) — top-level return
 * allowed. The structure guard excludes lone-identifier text files (e.g. a
 * file containing just `welcome`) which would technically parse as JS.
 */
function isExecutableJS(code) {
  if (!code || !code.trim()) return false
  if (/^\s*</.test(code)) return false       /* markup, not code */
  if (!/[;=(\n]/.test(code)) return false    /* no JS structure — treat as content */
  try {
    new vm.Script('(function(globals,v,arg){\n' + code + '\n})')
    return true
  } catch {
    return false
  }
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

  /* Extract executable code from data files into static .js files.
   * Static scripts served from 'self' need no auth and pass CSP. */
  const scriptsDir = join(DIST_CLIENT, 'scripts')
  await mkdir(scriptsDir, { recursive: true })
  const manifest = {}  /* 'ns/key' -> [inline <script> files] (self-executing) */
  const modules = {}   /* 'ns/key' -> wrapped module file (invoked as fn(globals, v, arg)) */
  const scriptRe = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g

  for (const [key, content] of Object.entries(bundle)) {
    const safeName = key.replace(/[^a-z0-9]/gi, '-')

    /* Raw-JS data file → wrap VERBATIM in a function inside a static .js file.
     * This is new Function(G,'v','arg',code) performed at BUILD time: same
     * parameter names, same `this`, same top-level return support — but no
     * runtime eval, so it passes Devvit's CSP and runs with a real browser
     * `window`/`document`. */
    if (isExecutableJS(content)) {
      const filename = 'scripts/mod-' + safeName + '.js'
      await writeFile(
        join(DIST_CLIENT, filename),
        'window.__qrx_mod=window.__qrx_mod||{};\n' +
        'window.__qrx_mod[' + JSON.stringify(key) + ']=function(globals,v,arg){\n' +
        content + '\n};\n'
      )
      modules[key] = filename
      continue
    }

    /* HTML page → extract inline <script> blocks (existing behavior) */
    const scripts = []
    let match, si = 0
    scriptRe.lastIndex = 0
    while ((match = scriptRe.exec(content)) !== null) {
      const code = match[1].trim()
      if (!code) continue
      const filename = 'scripts/' + safeName + '-' + si++ + '.js'
      await writeFile(join(DIST_CLIENT, filename), code)
      scripts.push(filename)
    }
    if (scripts.length) manifest[key] = scripts
  }
  await writeFile(join(DIST_CLIENT, 'scripts/manifest.json'), JSON.stringify(manifest))
  await writeFile(join(DIST_CLIENT, 'scripts/modules.json'), JSON.stringify(modules))
  /* the server bundle needs to know which keys are executable modules */
  await writeFile(join(__dirname, 'scripts-manifest.json'), JSON.stringify({ manifest, modules }))
  console.log('  scripts/manifest.json written with ' + Object.keys(manifest).length + ' keys')
  console.log('  scripts/modules.json written with ' + Object.keys(modules).length + ' kernel modules')

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
