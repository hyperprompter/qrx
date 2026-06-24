import express from 'express'
import vm from 'vm'
import { createServer, getServerPort, reddit, context } from '@devvit/web/server'
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared'
import bundledData from './data-bundle.json'

const DATA: Record<string, string> = bundledData

const app = express()
app.use(express.json({ limit: '4mb' }))

const router = express.Router()

router.post('/api/run', async (req, res): Promise<void> => {
  const { ns = 'main', hash = 'main', params = '', files = {} } = req.body

  function read(key: string, targetNs: string = ns): string {
    const clientKey = `${targetNs}:${key}`
    if (files[clientKey] !== undefined) return files[clientKey]
    return DATA[`${targetNs}/${key}`] ?? ''
  }

  function keys(targetNs: string = ns): string[] {
    return Object.keys(DATA)
      .filter(k => k.startsWith(targetNs + '/'))
      .map(k => k.slice(targetNs.length + 1))
  }

  /* Boot scripts are browser-specific (DOM, localStorage, etc).
   * They run client-side via pre-extracted static .js files.
   * Do not execute them here. */

  const vmGlobals = { read, keys, ns, hash, console, fetch, Promise }

  const p = new URLSearchParams(params)
  let v = read(hash) || ''
  let f = hash

  for (const [k, rawVal] of p) {
    const val = decodeURIComponent(rawVal)
    try {
      if (k === 'f') { f = val }
      else if (k === 'e') { v = val }
      else if (k === 'r') { v = read(val) || '' }
      else if (k === 'x') {
        const result = await vm.runInNewContext(`(async()=>{${val || v}})()`, { ...vmGlobals, v })
        if (result !== undefined) v = String(result)
      }
      else {
        const stored = read(k)
        if (stored) {
          const result = await vm.runInNewContext(`(async()=>{${stored}})()`, { ...vmGlobals, v, arg: val })
          if (result !== undefined) v = String(result)
        }
      }
    } catch (e) {
      console.error(`[QRX run] param ${k}:`, e)
    }
  }

  /* Strip inline scripts from html — client will load them from /scripts/ */
  const html = v.replace(/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/g, '')

  res.json({ html, scripts: `scripts/${`${ns}/${hash}`.replace(/[^a-z0-9]/gi, '-')}`, ns, hash })
})

router.post('/internal/menu/create-post', async (_req, res): Promise<void> => {
  res.json({
    showForm: {
      name: 'createPostForm',
      form: {
        title: 'Create QRX Post',
        acceptLabel: 'Create',
        cancelLabel: 'Cancel',
        fields: [
          {
            type: 'string',
            name: 'title',
            label: 'Post title',
            required: true,
          },
        ],
      },
    },
  } satisfies UiResponse)
})

router.post('/internal/form/create-post', async (req, res): Promise<void> => {
  const { title } = req.body as { title: string }
  try {
    await reddit.submitCustomPost({
      title,
      subredditName: context.subredditName!,
      entry: 'default',
      runAs: 'USER',
      userGeneratedContent: { text: title },
    })
    res.json({ showToast: { text: 'QRX post created!', appearance: 'success' } } satisfies UiResponse)
  } catch (err) {
    console.error('[QRX] Failed to create post:', err)
    res.json({ showToast: { text: 'Failed to create post.', appearance: 'neutral' } } satisfies UiResponse)
  }
})

app.use(router)

const port = getServerPort()
const server = createServer(app)
server.on('error', (err: Error) => console.error(`[QRX server] ${err.stack}`))
server.listen(port, () => console.log(`[QRX server] http://localhost:${port}`))