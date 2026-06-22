import { createServer } from 'http'
import { writeFile, readFile, mkdir, stat, readdir } from 'fs/promises'
import { join, dirname, resolve, extname } from 'path'
import { createReadStream, existsSync, readFileSync, watch } from 'fs'
import { fileURLToPath } from 'url'
import url from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.QRX_PORT || 3000
const DATA_DIR = resolve(join(process.cwd(), 'data'))
const INDEX_PATH = resolve(join(process.cwd(), 'public', 'data', 'index.json'))
const DIST_DIR = resolve(join(process.cwd(), 'dist'))
const SECRET = process.env.QRX_SYNC_KEY

// SSE clients waiting for write-event notifications
const clients = new Set()

/**
 * Namespace allowlist — controls which namespaces are publicly readable via /read.
 * Configured via QRX_PUBLIC_NAMESPACES env var (comma-separated).
 * 'main' and 'cache' are always included:
 *   - 'main' is the default kernel namespace
 *   - 'cache' holds previously fetched public URL content, already public by definition
 */
const includeRaw = process.env.QRX_PUBLIC_NAMESPACES || 'main'
const includeParsed = includeRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const INCLUDE_SET = new Set([...includeParsed, 'main', 'cache'])
const isNamespaceAllowed = (ns) => ns && INCLUDE_SET.has(ns.toLowerCase())

// Files and directories to skip when walking data/ for index generation
const IGNORE_LIST = ['.DS_Store', '.git', 'node_modules', '.gitlab-ci.yml']

/**
 * Encode URL-style keys so '://' is not mangled by path.join.
 * e.g. "https://foo.com/bar" -> "https%3A%2F/foo.com/bar"
 */
function toFsKey(key) {
  return key.replace(/:\//g, '%3A%2F')
}

/**
 * Reverse of toFsKey — used when listing keys back to clients in index.json.
 * e.g. "https%3A%2F/foo.com/bar" -> "https://foo.com/bar"
 */
function fromFsKey(key) {
  return key.replace(/%3A%2F/g, ':/')
}

/**
 * Recursively walks data/ and writes public/data/index.json — a flat list of
 * all "namespace/key" paths the bootloader uses to sync IndexedDB on page load.
 * Only emits entries whose namespace passes isNamespaceAllowed.
 */
async function updateDataIndex() {
  try {
    const results = []
    const namespaces = await readdir(DATA_DIR, { withFileTypes: true })

    for (const ns of namespaces) {
      if (!ns.isDirectory() || IGNORE_LIST.includes(ns.name)) continue
      if (!isNamespaceAllowed(ns.name)) continue

      async function walk(currentDir, currentPath) {
        const entries = await readdir(currentDir, { withFileTypes: true })
        for (const e of entries) {
          if (IGNORE_LIST.includes(e.name)) continue
          const itemPath = currentPath ? `${currentPath}/${e.name}` : e.name
          if (e.isDirectory()) {
            await walk(join(currentDir, e.name), itemPath)
          } else {
            // Decode fs-encoded keys so clients see the original key strings
            results.push(`${ns.name}/${fromFsKey(itemPath)}`)
          }
        }
      }

      await walk(join(DATA_DIR, ns.name), '')
    }

    await writeFile(INDEX_PATH, JSON.stringify(results))
  } catch (err) {
    console.error('[Indexer] Failed to generate index:', err)
  }
}

/**
 * Watch data/ for changes and rebuild index.json after a 30s debounce.
 * The debounce avoids thrashing on rapid successive writes.
 * Falls back gracefully if recursive watch is unsupported (some Linux kernels).
 */
let indexTimeout
function watchData() {
  try {
    watch(DATA_DIR, { recursive: true }, (eventType, filename) => {
      if (eventType !== 'rename' || !filename) return
      const segments = filename.split(/[/\\]/)
      const isIgnored = segments.some(s => IGNORE_LIST.includes(s) || s.endsWith('.lock'))
      if (isIgnored) return
      console.log(`[Indexer] Change detected: ${filename}. Rebuilding index in 30s...`)
      clearTimeout(indexTimeout)
      indexTimeout = setTimeout(async () => {
        await updateDataIndex()
        console.log('[Indexer] index.json updated.')
      }, 30000)
    })
  } catch (err) {
    console.warn('[Indexer] Recursive watch not supported on this OS. Automatic indexing disabled.')
  }
}

// Non-blocking startup: ensure directories exist, build initial index, start watcher
mkdir(DATA_DIR, { recursive: true }).catch(() => {})
mkdir(join(process.cwd(), 'public', 'data'), { recursive: true }).catch(() => {})
updateDataIndex()
watchData()

createServer(async (req, res) => {
  // CORS — open for local/self-hosted use; lock this down if exposing publicly
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  const parsedUrl = url.parse(req.url, true)
  const myUrl = new URL(req.url, `http://localhost`)

  /**
   * GET /stream — Server-Sent Events endpoint.
   * Clients subscribe here to receive real-time write notifications.
   * Protected by SECRET if QRX_SYNC_KEY is set.
   */
  if (req.method === 'GET' && myUrl.pathname === '/stream') {
    if (SECRET && parsedUrl.query.auth !== SECRET) return res.writeHead(401).end('Unauthorized')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  /**
   * GET /* — Static file server from dist/.
   * Special cases:
   *   - /data/index.json is served from public/data/index.json (the generated manifest)
   *   - /data/* anything else is blocked (use /read instead)
   *   - index.html gets window.NS injected if the request hostname has a matching data/ directory
   *   - Unknown paths with no file extension fall through to index.html (SPA routing)
   */
  if (req.method === 'GET') {
    const mimes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.css': 'text/css',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json',
    }

    let safePath = myUrl.pathname === '/' ? 'index.html' : myUrl.pathname
    let filePath

    if (safePath === '/data/index.json') {
      filePath = resolve(INDEX_PATH)
    } else if (safePath.startsWith('/data/')) {
      return res.writeHead(403).end('Direct data access blocked. Use /read endpoint.')
    } else {
      filePath = resolve(join(DIST_DIR, safePath))
      if (!filePath.startsWith(DIST_DIR)) return res.writeHead(403).end('Forbidden')
      try {
        const s = await stat(filePath)
        if (s.isDirectory()) throw new Error('is_dir')
      } catch {
        // Fall through to index.html for extensionless SPA routes; 404 for unknown extensions
        if (!mimes[extname(safePath)]) {
          filePath = resolve(join(DIST_DIR, 'index.html'))
        } else {
          return res.writeHead(404).end('Not Found')
        }
      }
    }

    try {
      await stat(filePath)

      if (filePath.endsWith('index.html')) {
        let html = await readFile(filePath, 'utf-8')

        // Inject window.NS if the hostname maps to a namespace directory —
        // this tells the kernel which DB to use without a URL path segment
        const host = (req.headers.host || '').split(':')[0]
        if (host && existsSync(join(DATA_DIR, host))) {
          html = html.replace('<body>', `<body><script>window.NS="${host}"</script>`)
        }

        res.writeHead(200, { 'Content-Type': 'text/html' })
        return res.end(html)
      }

      res.writeHead(200, { 'Content-Type': mimes[extname(filePath)] || 'application/octet-stream' })
      const stream = createReadStream(filePath)
      stream.on('error', () => { if (!res.headersSent) res.writeHead(500).end() })
      stream.pipe(res)
      return
    } catch {
      return res.writeHead(404).end('Not Found')
    }
  }

  /**
   * POST /write — Persist a value to data/namespace/key on disk.
   * Requires Authorization header matching QRX_SYNC_KEY.
   * After writing, rebuilds index.json and broadcasts an SSE event to all
   * connected clients so they can sync without polling.
   *
   * Body: { namespace, key, value, clientId }
   */
  if (req.method === 'POST' && myUrl.pathname === '/write') {
    let body = ''
    req.on('data', chunk => body += chunk.toString())
    req.on('end', async () => {
      try {
        const { namespace, key, value, clientId } = JSON.parse(body)
        if (SECRET && req.headers.authorization !== SECRET) {
          return res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }))
        }
        const fsKey = toFsKey(key)
        const targetPath = resolve(join(DATA_DIR, namespace, fsKey))
        if (!targetPath.startsWith(DATA_DIR)) throw new Error('Path traversal blocked')
        await mkdir(dirname(targetPath), { recursive: true })
        await writeFile(targetPath, value || '')
        await updateDataIndex()
        // Notify all SSE subscribers of the write so clients can react immediately
        const msg = 'data: ' + JSON.stringify({ namespace, key, clientId }) + '\n\n'
        clients.forEach(client => client.write(msg))
        res.writeHead(200).end(JSON.stringify({ status: 'saved' }))
      } catch (err) {
        res.writeHead(400).end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  /**
   * POST /read — Read a value from data/namespace/key on disk.
   * Public namespaces (per INCLUDE_SET) are readable without auth.
   * Private namespaces require the Authorization header.
   * Falls back to data/main/key if the namespaced path doesn't exist.
   *
   * Body: { namespace, key }
   */
  if (req.method === 'POST' && myUrl.pathname === '/read') {
    let body = ''
    req.on('data', chunk => body += chunk.toString())
    req.on('end', async () => {
      try {
        const { namespace, key } = JSON.parse(body)
        const hasValidKey = SECRET && req.headers.authorization === SECRET
        if (!hasValidKey && !isNamespaceAllowed(namespace)) {
          return res.writeHead(404).end(JSON.stringify({ error: 'Namespace not in allowlist' }))
        }
        const fsKey = toFsKey(key)
        let targetPath = resolve(join(DATA_DIR, namespace, fsKey))
        if (!targetPath.startsWith(DATA_DIR)) throw new Error('Path traversal blocked')
        let data
        try {
          data = await readFile(targetPath, 'utf-8')
        } catch {
          // Fallback: if key isn't in the requested namespace, try main
          if (namespace !== 'main') {
            targetPath = resolve(join(DATA_DIR, 'main', fsKey))
            if (!targetPath.startsWith(DATA_DIR)) throw new Error('Path traversal blocked')
            data = await readFile(targetPath, 'utf-8')
          } else {
            throw new Error('Not found')
          }
        }
        res.writeHead(200).end(JSON.stringify({ value: data }))
      } catch {
        res.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
      }
    })
    return
  }

  res.writeHead(404).end('Not Found')
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on http://0.0.0.0:${PORT}`)
})
