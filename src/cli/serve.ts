/**
 * A static file server for the viewer.
 *
 *   bun run serve          http://localhost:5173
 *   bun run serve -- 8080
 */

import { existsSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'

const port = Number(Bun.argv[2]) || 5173
const root = join(import.meta.dir, '..', '..', 'public')

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

if (!existsSync(join(root, 'main.js'))) {
  console.log('public/main.js is missing. Build it first:')
  console.log('  bun run viewer:build')
  process.exit(1)
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    let path = decodeURIComponent(url.pathname)
    if (path === '/') path = '/index.html'

    // Keep the server inside public/ regardless of what the path contains.
    const resolved = normalize(join(root, path))
    if (!resolved.startsWith(root)) {
      return new Response('forbidden', { status: 403 })
    }

    const file = Bun.file(resolved)
    if (!(await file.exists())) {
      return new Response('not found', { status: 404 })
    }

    return new Response(file, {
      headers: { 'content-type': types[extname(resolved)] ?? 'application/octet-stream' },
    })
  },
})

console.log(`viewer on http://localhost:${server.port}`)
