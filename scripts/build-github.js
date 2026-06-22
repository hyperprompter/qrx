/**
 * scripts/build-github.js
 *
 * Pre-build step for GitHub Pages static deployment.
 * Mirrors what server.js does at runtime:
 *   - Reads QRX_PUBLIC_NAMESPACES (plus always-included 'main' and 'cache')
 *   - Copies each allowed namespace from data/ into public/data/
 *   - Generates public/data/index.json (the flat key manifest the bootloader fetches)
 *
 * Run via: npm run build:github
 * (which is: node scripts/build-github.js && vite build)
 */

import { readdir, copyFile, mkdir, writeFile, readFile } from 'fs/promises'
import { join, dirname, resolve } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const PUBLIC_DATA_DIR = join(ROOT, 'public', 'data')
const INDEX_PATH = join(PUBLIC_DATA_DIR, 'index.json')

const IGNORE_LIST = ['.DS_Store', '.git', 'node_modules', '.gitlab-ci.yml']

// Mirror server.js namespace resolution logic exactly
const includeRaw = process.env.QRX_PUBLIC_NAMESPACES || 'main'
const includeParsed = includeRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const INCLUDE_SET = new Set([...includeParsed, 'main', 'cache'])

console.log(`\n  GitHub Pages build`)
console.log(`  Allowed namespaces: ${[...INCLUDE_SET].join(', ')}\n`)

/**
 * Decode %3A%2F back to :/ for index.json entries.
 * Mirrors fromFsKey() in server.js.
 */
function fromFsKey(key) {
  return key.replace(/%3A%2F/g, ':/')
}

/**
 * Recursively copy a directory tree from src to dest.
 * Skips anything in IGNORE_LIST.
 */
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

/**
 * Recursively walk a directory and return all file paths
 * relative to the given base, decoded from fs-encoding.
 */
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

async function main() {
  // Ensure public/data exists
  await mkdir(PUBLIC_DATA_DIR, { recursive: true })

  if (!existsSync(DATA_DIR)) {
    console.log('  No data/ directory found — writing empty index.json\n')
    await writeFile(INDEX_PATH, JSON.stringify([]))
    return
  }

  const namespaces = await readdir(DATA_DIR, { withFileTypes: true })
  const indexEntries = []

  for (const ns of namespaces) {
    if (!ns.isDirectory() || IGNORE_LIST.includes(ns.name)) continue
    if (!INCLUDE_SET.has(ns.name.toLowerCase())) {
      console.log(`  Skipping namespace: ${ns.name} (not in allowlist)`)
      continue
    }

    const srcDir = join(DATA_DIR, ns.name)
    const destDir = join(PUBLIC_DATA_DIR, ns.name)

    console.log(`  Copying namespace: ${ns.name} → public/data/${ns.name}`)
    await copyDir(srcDir, destDir)

    // Walk the copied dest dir to build index entries
    const keys = await walk(srcDir, '')
    for (const key of keys) {
      indexEntries.push(`${ns.name}/${key}`)
    }
    console.log(`    ${keys.length} keys indexed`)
  }

  await writeFile(INDEX_PATH, JSON.stringify(indexEntries))
  console.log(`\n  index.json written with ${indexEntries.length} total entries`)
  console.log(`  public/data/ is ready for static serving\n`)
}

main().catch(err => {
  console.error('build-github failed:', err)
  process.exit(1)
})
