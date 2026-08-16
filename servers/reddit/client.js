var A = document.getElementById('A')
var status = document.getElementById('status')
var files = {}
var scriptManifest = null
var moduleManifest = null
var loadedModules = {}
var seeded = false

window.DB = 'main'
window.FILES = 'files'
window.MAIN = 'main'
window.NS = Promise.resolve('main')

/* Registry populated by build-time-wrapped kernel modules
 * (dist/client/scripts/mod-*.js). This replaces new Function(),
 * which Devvit's CSP blocks at runtime. */
window.__qrx_mod = window.__qrx_mod || {}

/* Intercept iframe creation — override document.createElement to catch
 * every new iframe and proxy its src property before scripts set it. */
var _nativeCreateElement = document.createElement.bind(document)
document.createElement = function(tag) {
  var el = _nativeCreateElement(tag)
  if (tag.toLowerCase() === 'iframe') {
    var _src = ''
    Object.defineProperty(el, 'src', {
      get: function() { return _src },
      set: function(val) {
        _src = val
        if (val && !val.startsWith('http') && !val.startsWith('//') && val !== 'about:blank') {
          var hashMatch = val.match(/#(.+)$/)
          var hash = hashMatch ? hashMatch[1] : 'main'
          var self = this
          /* Don't navigate — write content directly */
          setTimeout(function() { renderIntoIframe(self, hash) }, 0)
        } else {
          el.setAttribute('src', val)
        }
      },
      configurable: true
    })
  }
  return el
}

async function renderIntoIframe(iframe, hash) {
  /* Wait until iframe is attached to DOM so contentDocument is accessible */
  var attempts = 0
  while (!iframe.isConnected && attempts++ < 50) {
    await new Promise(function(r) { setTimeout(r, 50) })
  }
  if (!iframe.isConnected) return

  try {
    /* The iframe hash may itself carry a tape: 'paint?windows=...' */
    var qIdx = hash.indexOf('?')
    var hname = qIdx === -1 ? hash : hash.slice(0, qIdx)
    var hparams = qIdx === -1 ? '' : hash.slice(qIdx + 1)

    var res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ns: 'main', hash: hname || 'main', params: hparams, files: {} })
    })
    var data = await res.json()
    var doc = iframe.contentDocument
    if (!doc) return
    doc.open()
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:8px;background:#000;color:#fff;font-family:monospace}</style></head><body>' + (data.html || '') + '</body></html>')
    doc.close()

    /* Kernel globals inside the iframe — wrapped modules resolve bare
     * read/write/filename through the scope chain to the iframe's window,
     * so they must exist there too. */
    var iw = doc.defaultView
    if (iw) {
      iw.__qrx_mod = iw.__qrx_mod || {}
      iw.read = window.read
      iw.write = window.write
      iw.filename = hname || 'main'
      iw.hydrate = function(h) { doc.body.innerHTML = h }
    }

    /* Inline page scripts extracted at build time (self-executing) */
    var manifest = await getManifest()
    var key = 'main/' + (hname || 'main')
    var scripts = manifest[key] || []
    for (var i = 0; i < scripts.length; i++) {
      var s = doc.createElement('script')
      s.src = '/' + scripts[i]
      doc.head.appendChild(s)
      await new Promise(function(r) { s.onload = r; s.onerror = r })
    }

    /* Tape-deferred kernel modules, in tape order */
    var clientScripts = data.clientScripts || []
    var v2 = data.html || ''
    for (var j = 0; j < clientScripts.length; j++) {
      try {
        var fn = await loadModuleInto(iw, doc, clientScripts[j].key, clientScripts[j].src)
        if (fn) {
          var r2 = await fn.call(iw, iw, v2, clientScripts[j].arg)
          if (r2 !== undefined) v2 = String(r2)
        }
      } catch(e) { console.error('[QRX iframe mod]', clientScripts[j].key, e) }
    }
  } catch(e) {
    console.error('[QRX iframe]', hash, e)
  }
}

function setStatus(s) { status.textContent = s }

function openDB(name, store) {
  name = name || 'main'
  store = store || 'files'
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(name)
    req.onupgradeneeded = function(e) { e.target.result.createObjectStore(store) }
    req.onsuccess = function(e) { resolve(e.target.result) }
    req.onerror = reject
  })
}

function dbGet(db, key) {
  return new Promise(function(resolve) {
    var req = db.transaction('files', 'readonly').objectStore('files').get(key)
    req.onsuccess = function(e) { resolve(e.target.result) }
    req.onerror = function() { resolve(undefined) }
  })
}

function dbPut(db, key, value) {
  return new Promise(function(resolve, reject) {
    var req = db.transaction('files', 'readwrite').objectStore('files').put(value, key)
    req.onsuccess = resolve
    req.onerror = reject
  })
}

function dbGetAllKeys(db) {
  return new Promise(function(resolve) {
    var req = db.transaction('files', 'readonly').objectStore('files').getAllKeys()
    req.onsuccess = function(e) { resolve(e.target.result) }
    req.onerror = function() { resolve([]) }
  })
}

function getManifest() {
  if (scriptManifest) return Promise.resolve(scriptManifest)
  return fetch('/scripts/manifest.json').then(function(res) {
    scriptManifest = res.ok ? res.json() : {}
    return scriptManifest
  })
}

function getModules() {
  if (moduleManifest) return Promise.resolve(moduleManifest)
  return fetch('/scripts/modules.json').then(function(res) {
    moduleManifest = res.ok ? res.json() : {}
    return moduleManifest
  }).catch(function() {
    moduleManifest = {}
    return moduleManifest
  })
}

function loadScript(src) {
  return new Promise(function(resolve) {
    var s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = function(e) { console.warn('[QRX] script failed:', src, e); resolve() }
    document.head.appendChild(s)
  })
}

/* Load a wrapped module file into a given window/document and return the
 * registered function. Loading is registration; invocation is separate,
 * which is what lets us pass (globals, v, arg) per tape step. */
async function loadModuleInto(win, doc, key, src) {
  if (!win.__qrx_mod[key]) {
    var s = doc.createElement('script')
    s.src = '/' + src
    doc.head.appendChild(s)
    await new Promise(function(r) { s.onload = r; s.onerror = r })
  }
  return win.__qrx_mod[key]
}

/* Invoke a kernel module in the MAIN window.
 * fn.call(window, window, v, arg) reproduces the kernel's
 * (new Function(G,'v','arg',code))(this,v,val) exactly. */
async function runModule(key, v, arg) {
  var mods = await getModules()
  var src = mods[key]
  if (!src) return undefined
  if (!loadedModules[src]) {
    await loadScript('/' + src)   /* registers window.__qrx_mod[key] */
    loadedModules[src] = true
  }
  var fn = window.__qrx_mod[key]
  return fn ? await fn.call(window, window, v, arg) : undefined
}

/* ---- kernel compatibility shims ----------------------------------------
 * Wrapped modules were written for the kernel's new Function(G,'v','arg')
 * convention: v and arg arrive as parameters, but every other bare
 * identifier (read, write, filename, hydrate, ...) resolves through the
 * scope chain to window — so they must exist as window globals. */

window.filename = 'main'

window.read = async function(k, nsName) {
  var db = await openDB(nsName || 'main')
  var v = await dbGet(db, k)
  if (v === undefined || v === '') {
    try {
      var r = await fetch('/data/' + (nsName || 'main') + '/' + k)
      if (r.ok) v = await r.text()
    } catch(e) {}
  }
  return v
}

window.write = async function(v, k, nsName) {
  return dbPut(await openDB(nsName || 'main'), k || window.filename, v)
}

/* CSP blocks inline scripts, so on Reddit hydrate() can only inject
 * markup — executable behavior arrives via modules/manifest scripts. */
window.hydrate = function(h) { A.innerHTML = h }

async function seedIndexedDB(manifest) {
  var nsMap = {}
  Object.keys(manifest).forEach(function(k) {
    var parts = k.split('/')
    var ns = parts[0]
    var key = parts.slice(1).join('/')
    if (ns === 'cache') return
    if (!nsMap[ns]) nsMap[ns] = []
    nsMap[ns].push(key)
  })

  try {
    var idxRes = await fetch('/data/index.json')
    if (idxRes.ok) {
      var idxList = await idxRes.json()
      idxList.forEach(function(item) {
        var parts = item.split('/')
        var ns = parts[0]
        var key = parts.slice(1).join('/')
        if (ns === 'cache') return
        if (!nsMap[ns]) nsMap[ns] = []
        if (!nsMap[ns].includes(key)) nsMap[ns].push(key)
      })
    }
  } catch(e) {}

  var currentHash = location.hash.replace('#', '') || 'main'

  for (var ns in nsMap) {
    var db = await openDB(ns)
    var existingKeys = await dbGetAllKeys(db)
    for (var i = 0; i < nsMap[ns].length; i++) {
      var key = nsMap[ns][i]
      var exists = existingKeys.includes(key)
      if (key.startsWith('boot/') || key === currentHash) {
        try {
          var contentRes = await fetch('/data/' + ns + '/' + key)
          if (contentRes.ok) {
            var text = await contentRes.text()
            var localVal = exists ? await dbGet(db, key) : null
            if (localVal !== text) await dbPut(db, key, text)
          }
        } catch(e) {}
      } else if (!exists) {
        await dbPut(db, key, '')
      }
    }
    if (ns === 'main') {
      var idxVal = nsMap[ns].map(function(k) { return ns + '/' + k })
      await dbPut(db, 'index.json', JSON.stringify(idxVal))
    }
  }
}

async function run() {
  /* If we're inside a Reddit post, check for a stored hash and apply it
   * before the kernel boots. Falls back silently if not in a post context. */
  if (!location.hash) {
    try {
      var ctxRes = await fetch('/api/post-context')
      if (ctxRes.ok) {
        var ctxData = await ctxRes.json()
        if (ctxData.hash) {
          /* Setting location.hash fires onhashchange, which calls run()
           * again. RETURN here so this invocation doesn't also continue —
           * otherwise the entire tape (boot + modules) executes twice and
           * every window opens twice. */
          location.hash = ctxData.hash
          return
        }
      }
    } catch(e) {}
  }

  var hash = location.hash.slice(1) || 'main'
  var qIdx = hash.indexOf('?')
  var name = qIdx === -1 ? hash : hash.slice(0, qIdx)
  var params = qIdx === -1 ? '' : hash.slice(qIdx + 1)

  /* the kernel sets filename before running boot/* and the tape */
  window.filename = name

  setStatus('running...')
  try {
    var manifest = await getManifest()

    if (!seeded) {
      setStatus('seeding...')
      await seedIndexedDB(manifest)
      seeded = true
    }

    var res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ns: 'main', hash: name, params: params, files: files })
    })
    var data = await res.json()
    A.innerHTML = data.html || ''

    /* Boot modules run on EVERY navigation, like the kernel's boot/* loop. */
    var mods = await getModules()
    var bootModKeys = Object.keys(mods).filter(function(k) { return k.indexOf('/boot/') !== -1 })
    for (var bm = 0; bm < bootModKeys.length; bm++) {
      try { await runModule(bootModKeys[bm], undefined, undefined) }
      catch(e) { console.error('[QRX boot]', bootModKeys[bm], e) }
    }

    /* Tape-deferred scripts in tape order, chaining the accumulator like
     * the kernel: a module's return value becomes v for the next step. */
    var v2 = data.html || ''
    var dirty = false
    var clientScripts = data.clientScripts || []
    for (var cs = 0; cs < clientScripts.length; cs++) {
      try {
        var r2 = await runModule(clientScripts[cs].key, v2, clientScripts[cs].arg)
        if (r2 !== undefined) { v2 = String(r2); dirty = true }
      } catch(e) { console.error('[QRX mod]', clientScripts[cs].key, e) }
    }
    if (dirty) A.innerHTML = v2

    /* Boot inline scripts extracted from HTML boot pages */
    var bootKeys = Object.keys(manifest).filter(function(k) { return k.includes('/boot/') })
    for (var b = 0; b < bootKeys.length; b++) {
      var bootScripts = manifest[bootKeys[b]] || []
      for (var bi = 0; bi < bootScripts.length; bi++) {
        await loadScript('/' + bootScripts[bi])
      }
    }

    /* Page inline scripts extracted from the current HTML page */
    var key = 'main/' + name
    var scripts = manifest[key] || []
    for (var i = 0; i < scripts.length; i++) {
      await loadScript('/' + scripts[i])
    }

    setStatus('')
  } catch(e) {
    setStatus('error: ' + e.message)
    console.error('[QRX client]', e)
  }
}

window.onhashchange = run
run()
