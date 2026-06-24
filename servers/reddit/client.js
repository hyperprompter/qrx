var A = document.getElementById('A')
var status = document.getElementById('status')
var files = {}
var scriptManifest = null
var seeded = false

/* Kernel globals the stored scripts expect */
window.DB = 'main'
window.FILES = 'files'
window.MAIN = 'main'

function setStatus(s) { status.textContent = s }

/* Minimal IndexedDB helpers mirroring the kernel */
function openDB(name, store) {
  name = name || window.DB
  store = store || window.FILES
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(name)
    req.onupgradeneeded = function(e) { e.target.result.createObjectStore(store) }
    req.onsuccess = function(e) { resolve(e.target.result) }
    req.onerror = reject
  })
}

function dbGet(db, key) {
  return new Promise(function(resolve) {
    var req = db.transaction(window.FILES, 'readonly').objectStore(window.FILES).get(key)
    req.onsuccess = function(e) { resolve(e.target.result) }
    req.onerror = function() { resolve(undefined) }
  })
}

function dbPut(db, key, value) {
  return new Promise(function(resolve, reject) {
    var req = db.transaction(window.FILES, 'readwrite').objectStore(window.FILES).put(value, key)
    req.onsuccess = resolve
    req.onerror = reject
  })
}

function dbGetAllKeys(db) {
  return new Promise(function(resolve) {
    var req = db.transaction(window.FILES, 'readonly').objectStore(window.FILES).getAllKeys()
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
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = function(e) { console.warn('[QRX] script failed:', src, e); resolve() }
    document.head.appendChild(s)
  })
}

/* Seed IndexedDB from the data manifest — mirrors the static bootloader */
async function seedIndexedDB() {
  var manifest = await getManifest()
  var allKeys = Object.keys(manifest)

  /* Build ns → [keys] map */
  var nsMap = {}
  allKeys.forEach(function(k) {
    var parts = k.split('/')
    var ns = parts[0]
    var key = parts.slice(1).join('/')
    if (ns === 'cache') return
    if (!nsMap[ns]) nsMap[ns] = []
    nsMap[ns].push(key)
  })

  /* Also add keys that have no scripts (pure data files) from data/index.json */
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
        /* Fetch full content from static data files */
        try {
          var contentRes = await fetch('/data/' + ns + '/' + key)
          if (contentRes.ok) {
            var text = await contentRes.text()
            var localVal = exists ? await dbGet(db, key) : null
            if (localVal !== text) {
              await dbPut(db, key, text)
            }
          }
        } catch(e) {}
      } else if (!exists) {
        await dbPut(db, key, '')
      }
    }

    /* Store index.json in main db */
    if (ns === 'main') {
      var idxVal = nsMap[ns].map(function(k) { return ns + '/' + k })
      await dbPut(db, 'index.json', JSON.stringify(idxVal))
    }
  }
}

async function run() {
  var hash = location.hash.slice(1) || 'main'
  var parts = hash.split('?')
  var name = parts[0]
  var params = parts[1] || ''

  setStatus('running...')
  try {
    var manifest = await getManifest()

    /* Seed IndexedDB on first run */
    if (!seeded) {
      setStatus('seeding...')
      await seedIndexedDB()
      seeded = true
    }

    var res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ns: 'main', hash: name, params: params, files: files })
    })
    var data = await res.json()
    A.innerHTML = data.html || ''

    /* Load boot scripts first */
    var bootKeys = Object.keys(manifest).filter(function(k) { return k.includes('/boot/') })
    for (var b = 0; b < bootKeys.length; b++) {
      var bootScripts = manifest[bootKeys[b]] || []
      for (var bi = 0; bi < bootScripts.length; bi++) {
        await loadScript('/' + bootScripts[bi])
      }
    }

    /* Load scripts for this key */
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