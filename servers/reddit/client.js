var A = document.getElementById('A')
var status = document.getElementById('status')
var files = {}
var scriptManifest = null
var seeded = false

window.DB = 'main'
window.FILES = 'files'
window.MAIN = 'main'
window.NS = Promise.resolve('main')

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
    var res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ns: 'main', hash: hash, params: '', files: {} })
    })
    var data = await res.json()
    var doc = iframe.contentDocument
    if (!doc) return
    doc.open()
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:8px;background:#000;color:#fff;font-family:monospace}</style></head><body>' + (data.html || '') + '</body></html>')
    doc.close()

    var manifest = await getManifest()
    var key = 'main/' + hash
    var scripts = manifest[key] || []
    for (var i = 0; i < scripts.length; i++) {
      var s = doc.createElement('script')
      s.src = '/' + scripts[i]
      doc.head.appendChild(s)
      await new Promise(function(r) { s.onload = r; s.onerror = r })
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

async function getManifest() {
  if (scriptManifest) return scriptManifest
  var res = await fetch('/scripts/manifest.json')
  scriptManifest = await res.json()
  return scriptManifest
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

/* Rewrite iframe src: /main#bundle → /#bundle
 * Devvit static server only knows index.html at root. */

async function run() {
  var hash = location.hash.slice(1) || 'main'
  var parts = hash.split('?')
  var name = parts[0]
  var params = parts[1] || ''

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

    var bootKeys = Object.keys(manifest).filter(function(k) { return k.includes('/boot/') })
    for (var b = 0; b < bootKeys.length; b++) {
      var bootScripts = manifest[bootKeys[b]] || []
      for (var bi = 0; bi < bootScripts.length; bi++) {
        await loadScript('/' + bootScripts[bi])
      }
    }

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