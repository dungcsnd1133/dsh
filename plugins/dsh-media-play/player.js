import { createReadStream, statSync } from 'node:fs'
import { basename, join } from 'node:path'

export const name = 'dsh-media-play'
export const inject = ['webServer']

const FILE_NAME = /^[a-f0-9]{16}\.(mp3|jpg|jpeg|png|webp|mp4)$/

function contentType(file) {
  if (file.endsWith('.mp3')) return 'audio/mpeg'
  if (file.endsWith('.mp4')) return 'video/mp4'
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).split(',')[0].trim())
  if (!match) return null
  const startText = match[1]
  const endText = match[2]
  if (startText === '' && endText === '') return null
  let start
  let end
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText === '' ? size - 1 : Number(endText)
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= size || start > end) return null
  return { start, end }
}

function serveFile(req, res, filePath, type) {
  let size
  try {
    size = statSync(filePath).size
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  }
  if (req.headers.range) {
    const span = byteRange(req.headers.range, size)
    if (!span) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${span.start}-${span.end}/${size}`,
      'content-length': span.end - span.start + 1,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(filePath, { start: span.start, end: span.end }).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'content-length': size })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

function watchPage(file) {
  const src = `/play/${file}`
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Video</title>
<style>
  html,body{margin:0;height:100%;background:#111}
  body{display:grid;place-items:center}
  video{width:min(100%,480px);max-height:100vh;background:#000}
</style>
<video controls autoplay playsinline src="${src}"></video>
`
}

export function apply(ctx, config) {
  const mediaDir = config?.mediaDir
  if (!mediaDir) throw new Error('mediaDir is required')
  ctx.webServer.register({
    kind: 'prefix',
    path: '/play/watch',
    handler(req, res) {
      const file = basename(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (!FILE_NAME.test(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      const html = watchPage(file)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'content-length': Buffer.byteLength(html),
      })
      res.end(req.method === 'HEAD' ? undefined : html)
    },
  })

  ctx.webServer.register({
    kind: 'prefix',
    path: '/play',
    handler(req, res) {
      const file = basename(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (!FILE_NAME.test(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      serveFile(req, res, join(mediaDir, file), contentType(file))
    },
  })
}
