/**
 * Host half of the zen-mode bundle.
 *
 * The browser half owns every visible part. The one thing it cannot own is the
 * mascot animation: a client bundle is a single script with no way to reach a
 * sibling file, so embedding a 216 KB image would triple the script the page
 * downloads. This half serves it over the Web carrier instead, and the browser
 * half simply points an `img` at the route.
 *
 * A deployment without a Web carrier keeps working: the route is never
 * registered, the image request fails, and the browser half hides the element.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Path the browser half requests; exact, so it cannot shadow any other route. */
const MASCOT_ROUTE = '/zen-mode/mascot.webp'

/** Directory holding this module, and therefore the packaged image. */
const HERE = dirname(fileURLToPath(import.meta.url))

/** Services this half needs before it can answer requests. */
export const inject = ['webServer']

/**
 * Serve the packaged mascot animation.
 * @param ctx - the Host context; `webServer` is required to answer requests.
 */
export function apply(ctx) {
  /** Cached bytes; a failed read stays cached so a broken package does not retry per request. */
  let bytes = null
  const load = async () => {
    if (bytes !== null) return bytes
    try {
      bytes = await readFile(join(HERE, 'mascot.webp'))
    } catch (error) {
      console.error('[zen-mode] could not read mascot.webp', error)
      bytes = false
    }
    return bytes
  }

  ctx.effect(() => {
    // Warm the cache so the first paint of zen mode does not wait on disk.
    void load()
    return ctx.webServer.register({
      kind: 'exact',
      path: MASCOT_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET, HEAD')
          res.end()
          return
        }
        const data = await load()
        if (data === false) {
          res.statusCode = 404
          res.end()
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/webp')
        res.setHeader('Content-Length', String(data.length))
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.end(req.method === 'HEAD' ? undefined : data)
      },
    })
  }, 'zen-mode: mascot route')
}
