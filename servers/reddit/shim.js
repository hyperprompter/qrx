/* QRX Reddit shim — prepended to kernel-0.js for Devvit deployment.
 * Must run before any other code. Overrides eval and Function globally
 * to route through a Web Worker which is free of unsafe-eval CSP. */

var _qrxWorker = new Worker('/worker.js')
var _qrxPending = {}
var _qrxId = 0

_qrxWorker.onmessage = function(e) {
  var p = _qrxPending[e.data.id]
  if (!p) return
  delete _qrxPending[e.data.id]
  if (e.data.error) p.reject(new Error(e.data.error))
  else p.resolve(e.data.result)
}

_qrxWorker.onerror = function(e) {
  console.error('[QRX worker error]', e.message)
}

function execInWorker(names, values, code) {
  return new Promise(function(resolve, reject) {
    var id = ++_qrxId
    _qrxPending[id] = { resolve: resolve, reject: reject }
    var safeVals = values.map(function(v) {
      try { return JSON.parse(JSON.stringify(v)) } catch(e) { return undefined }
    })
    _qrxWorker.postMessage({ id: id, args: { names: names, values: safeVals }, code: code })
  })
}

/* Override Function constructor — assign both to window and as global */
var _NativeFunction = Function
var _shimmedFunction = function() {
  var args = Array.from(arguments)
  if (args.length === 0) return new _NativeFunction()
  var body = args[args.length - 1]
  var params = args.slice(0, -1)
  return function() {
    return execInWorker(params, Array.from(arguments), body)
  }
}
_shimmedFunction.prototype = _NativeFunction.prototype
window.Function = _shimmedFunction
/* Also override via Object.defineProperty to catch any direct Function references */
try {
  Object.defineProperty(window, 'Function', {
    get: function() { return _shimmedFunction },
    set: function() {},
    configurable: true
  })
} catch(e) {}

/* Override eval */
window.eval = function(code) {
  return execInWorker([], [], code)
}
try {
  Object.defineProperty(window, 'eval', {
    get: function() { return function(code) { return execInWorker([], [], code) } },
    set: function() {},
    configurable: true
  })
} catch(e) {}

/* Patch hydrate once kernel defines it */
var _hydrateInterval = setInterval(function() {
  if (typeof window.hydrate === 'function' && window.hydrate !== _patchedHydrate) {
    window.hydrate = _patchedHydrate
    clearInterval(_hydrateInterval)
  }
}, 10)

function _patchedHydrate(h) {
  window.A.innerHTML = h
  window.A.querySelectorAll('script').forEach(function(o) {
    if (o.src) return
    var code = o.textContent
    if (!code.trim()) return
    execInWorker([], [], code).catch(function(e) {
      console.error('[QRX hydrate]', e)
    })
    o.remove()
  })
}