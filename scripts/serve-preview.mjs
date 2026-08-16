import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number.parseInt(process.env.PREVIEW_PORT ?? '43171', 10)
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
])

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  const relative = pathname === '/' ? '.tmp/ui-preview/index.html' : pathname.slice(1)
  const target = path.resolve(root, relative)
  if (!target.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  try {
    if (!statSync(target).isFile()) throw new Error('Not a file')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', contentTypes.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream')
    createReadStream(target).pipe(response)
  } catch {
    response.writeHead(404).end('Not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log('Preview server: http://127.0.0.1:' + port + '/')
})
