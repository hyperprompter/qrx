/* QRX execution worker — served from dist/client/worker.js
 * Loaded by the shim as new Worker('/worker.js').
 * Receives code + args via postMessage, runs new Function() freely
 * (Workers from 'self' are not subject to the parent page's unsafe-eval CSP),
 * posts result back to main thread. */

self.onmessage = async function(e) {
  const { id, args, code } = e.data
  try {
    const fn = new Function(...args.names, code)
    const result = await fn(...args.values)
    self.postMessage({ id, result, error: null })
  } catch(err) {
    self.postMessage({ id, result: undefined, error: err.message })
  }
}