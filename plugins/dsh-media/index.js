/**
 * Session tools that speak text, create or edit an image (via 2-layer Antigravity Image Connector + Antigravity Executor),
 * and make a video from text or from a still. Files are saved locally and served at /media.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, createReadStream, statSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import yaml from 'yaml'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-media'
export const inject = ['tools', 'webServer']
export const Config = z.object({
  publicOrigin: z.string().required(),
  mediaDir: z.string().required(),
})

const VOICES = [
  'eve', 'ara', 'rex', 'sal', 'leo',
  'carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith',
  'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa',
  'sirius', 'lumen', 'castor', 'naksh', 'atlas', 'aurora', 'liora',
]
const LANGUAGES = [
  'auto', 'en', 'vi', 'ar-EG', 'ar-SA', 'ar-AE', 'bn', 'zh', 'fr', 'de',
  'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'pt-PT', 'ru', 'es-MX', 'es-ES', 'tr',
]
const IMAGE_MODEL = 'gemini-3.1-flash-image'
const VIDEO_MODEL = 'grok-imagine-video-1.5'
const IMAGE_ASPECT_RATIOS = [
  '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2',
  '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1', '21:9', '5:2', 'auto',
]
const IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536']
const VIDEO_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2']
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p']
const FILE_NAME = /^[a-f0-9]{16}\.(mp3|jpg|jpeg|png|webp|mp4)$/

const CREDENTIALS_FILE = '/app/applet/.dsh-home/.credentials.yaml'
const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ?? ''
const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET ?? ''
const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc'

function readAntigravityCredential() {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null
    const doc = yaml.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
    const payload = doc?.records?.['llm-pi-ai/google']?.payload
    if (!payload || typeof payload.access !== 'string' || typeof payload.refresh !== 'string') {
      return null
    }
    return {
      access: payload.access,
      refresh: payload.refresh,
      expires: Number(payload.expires || 0),
      projectId: typeof payload.projectId === 'string' && payload.projectId ? payload.projectId : ANTIGRAVITY_DEFAULT_PROJECT_ID,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    }
  } catch {
    return null
  }
}

function saveAntigravityCredential(updated) {
  try {
    let doc = { version: 1, records: {} }
    if (existsSync(CREDENTIALS_FILE)) {
      try {
        const parsed = yaml.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
        if (parsed && typeof parsed === 'object') doc = parsed
      } catch {
        // start fresh if corrupt
      }
    }
    doc.version = 1
    doc.records = doc.records || {}
    doc.records['llm-pi-ai/google'] = {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: updated.access,
        refresh: updated.refresh,
        expires: Math.floor(updated.expires),
        projectId: updated.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
        ...(updated.email ? { email: updated.email } : {}),
      },
    }
    writeFileSync(CREDENTIALS_FILE, yaml.stringify(doc), { mode: 0o600 })
    chmodSync(CREDENTIALS_FILE, 0o600)
  } catch {
    // ignore
  }
}

async function getValidAntigravityCredential(signal) {
  const cred = readAntigravityCredential()
  if (!cred) return null
  if (Date.now() + 5 * 60 * 1000 < cred.expires) {
    return cred
  }
  const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: cred.refresh,
      grant_type: 'refresh_token',
    }),
    signal,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Antigravity refresh token failed (${res.status}) — please reconnect your Antigravity account: ${errText}`)
  }
  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Antigravity token refresh response missing access_token')
  }
  const updated = {
    access: data.access_token,
    refresh: data.refresh_token || cred.refresh,
    expires: Date.now() + (data.expires_in || 3600) * 1000 - 5 * 60 * 1000,
    projectId: cred.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
    email: cred.email,
  }
  saveAntigravityCredential(updated)
  return updated
}

function gcd(a, b) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

/**
 * Layer 1 (Bộ nối ảnh): Chuẩn hóa model + aspect_ratio / size thành tên nội bộ có hậu tố
 * Ví dụ: { model: "gemini-3.1-flash-image", aspect_ratio: "9:16" } -> "gemini-3.1-flash-image-9x16"
 */
export function buildImageConnectorModelName(baseModel, aspectRatio, size) {
  const cleanBase = (baseModel || IMAGE_MODEL).trim()
  if (size && size !== 'auto' && /^\d+x\d+$/i.test(size.trim())) {
    return `${cleanBase}-${size.trim().toLowerCase()}`
  }
  if (aspectRatio && aspectRatio !== 'auto') {
    const suffix = aspectRatio.trim().replace(':', 'x')
    return `${cleanBase}-${suffix}`
  }
  return cleanBase
}

/**
 * Layer 2 (Bộ thực thi Antigravity): Tách hậu tố tỷ lệ/kích thước khỏi tên model
 * - Nếu hậu tố là kích thước như 1024x1536 -> rút gọn GCD thành tỷ lệ 2:3
 * - Nếu hậu tố là tỷ lệ như 9x16 -> chuyển thành 9:16
 * - Nếu không có hậu tố -> mặc định 1:1
 */
export function parseAntigravityImageModelAndRatio(internalModelName) {
  const match = /^(gemini-[a-z0-9.-]+-image)(?:-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?))?$/i.exec(internalModelName.trim())
  if (!match) {
    return { upstreamModel: IMAGE_MODEL, aspectRatio: '1:1' }
  }
  const upstreamModel = match[1]
  const rawW = match[2]
  const rawH = match[3]
  if (!rawW || !rawH) {
    return { upstreamModel, aspectRatio: '1:1' }
  }
  const w = Number(rawW)
  const h = Number(rawH)
  if (Number.isInteger(w) && Number.isInteger(h) && w >= 64 && h >= 64) {
    const divisor = gcd(w, h)
    return {
      upstreamModel,
      aspectRatio: `${w / divisor}:${h / divisor}`,
    }
  }
  return {
    upstreamModel,
    aspectRatio: `${rawW}:${rawH}`,
  }
}

function isValidDecodedImageBuffer(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64) return false
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true
  // WEBP (RIFF....WEBP)
  if (bytes.slice(0, 4).toString() === 'RIFF' && bytes.slice(8, 12).toString() === 'WEBP') return true
  // GIF
  if (bytes.slice(0, 3).toString() === 'GIF') return true
  return false
}

function imageExtension(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes.slice(0, 4).toString() === 'RIFF') return 'webp'
  return 'png'
}

/**
 * Bộ thực thi Antigravity cho nhánh ảnh:
 * - Gọi POST /v1internal:generateContent (chờ JSON hoàn chỉnh, không dùng streamGenerateContent)
 * - requestType: "image_gen", userAgent: "antigravity", không chèn system prompt Claude
 * - Kiểm tra chặt dữ liệu ảnh tại candidates[0].content.parts hoặc response.candidates[0].content.parts
 *   để không bao giờ báo thành công giả với b64_json: ""
 */
export async function executeAntigravityImageGen({
  internalModelName,
  prompt,
  sourceImage,
  sessionId,
  signal,
}) {
  const cred = await getValidAntigravityCredential(signal)
  if (!cred) {
    throw new Error('Chưa kết nối tài khoản Google Antigravity. Vui lòng bấm nút "Sign in with Antigravity" ở góc trên bên phải để đăng nhập.')
  }

  const { upstreamModel, aspectRatio } = parseAntigravityImageModelAndRatio(internalModelName)

  const parts = []
  if (sourceImage && sourceImage.base64) {
    parts.push({
      inlineData: {
        mimeType: sourceImage.mimeType || 'image/png',
        data: sourceImage.base64,
      },
    })
  }
  parts.push({ text: prompt })

  const requestPayload = {
    project: cred.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
    model: upstreamModel,
    userAgent: 'antigravity',
    requestType: 'image_gen',
    requestId: `img-${Date.now()}-${randomBytes(4).toString('hex')}`,
    request: {
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        imageConfig: {
          aspectRatio,
        },
      },
      sessionId: sessionId || `sess-${Date.now()}`,
    },
  }

  const headers = {
    Authorization: `Bearer ${cred.access}`,
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity/1.15.8 darwin/arm64',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    }),
  }

  const endpoints = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
  ]

  let lastError = ''
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal,
      })
      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        lastError = `HTTP ${response.status} from ${endpoint}: ${errBody.slice(0, 300)}`
        continue
      }
      const json = await response.json()
      const candidateParts =
        json?.candidates?.[0]?.content?.parts ??
        json?.response?.candidates?.[0]?.content?.parts ??
        []

      const validDataItems = []
      for (const part of candidateParts) {
        const rawB64 = part?.inlineData?.data
        if (typeof rawB64 !== 'string' || rawB64.trim().length === 0) continue
        const cleanB64 = rawB64.trim()
        const decoded = Buffer.from(cleanB64, 'base64')
        if (!isValidDecodedImageBuffer(decoded)) continue
        validDataItems.push({
          b64_json: cleanB64,
          bytes: decoded,
          mimeType: part?.inlineData?.mimeType || `image/${imageExtension(decoded)}`,
        })
      }

      if (validDataItems.length === 0) {
        const textExplanation = candidateParts
          .map((p) => (typeof p?.text === 'string' ? p.text : ''))
          .filter(Boolean)
          .join(' ')
          .slice(0, 240)
        throw new Error(
          `Antigravity returned HTTP 200 but no valid image data (inlineData.data was empty or missing)${
            textExplanation ? `: "${textExplanation}"` : ''
          }`
        )
      }

      return {
        created: Math.floor(Date.now() / 1000),
        data: validDataItems,
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  throw new Error(`Antigravity image generation failed: ${lastError}`)
}

async function save(store, bytes, extension) {
  const file = `${randomBytes(8).toString('hex')}.${extension}`
  await writeFile(join(store.dir, file), bytes)
  return store.url(file)
}

async function readSourceImage(store, imageUrlInput, signal) {
  const localMatch = /\/media\/([a-f0-9]{16}\.(?:jpg|jpeg|png|webp))$/i.exec(imageUrlInput)
  if (localMatch) {
    const filePath = join(store.dir, localMatch[1])
    const bytes = await readFile(filePath)
    return {
      base64: bytes.toString('base64'),
      mimeType: contentType(localMatch[1]),
    }
  }
  const response = await fetch(imageUrlInput, { signal })
  if (!response.ok) throw new Error(`Could not read the source image (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const ext = imageExtension(bytes)
  return {
    base64: bytes.toString('base64'),
    mimeType: contentType(`file.${ext}`),
  }
}

function apiKey() {
  const key = process.env.XAI_API_KEY
  if (!key) throw new Error('XAI_API_KEY is not set')
  return key
}

async function xai(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`https://api.x.ai${path}`, {
    method,
    signal,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400)
    throw new Error(`xAI ${path} failed (${response.status}): ${detail}`)
  }
  return response
}

async function download(store, url, fallbackExtension, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not download the result (${response.status})`)
  const type = response.headers.get('content-type') ?? ''
  const extension = type.includes('png') ? 'png'
    : type.includes('webp') ? 'webp'
    : type.includes('mp4') ? 'mp4'
    : type.includes('mpeg') || type.includes('mp3') ? 'mp3'
    : fallbackExtension
  return save(store, Buffer.from(await response.arrayBuffer()), extension)
}

function pick(value, allowed, fallback) {
  if (value === undefined || value === '') return fallback
  const found = allowed.find((item) => item.toLowerCase() === String(value).toLowerCase())
  if (!found) throw new Error(`must be one of: ${allowed.join(', ')}`)
  return found
}

function result(kind, url, detail) {
  return { kind, url, note: detail }
}

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true },
    url: { type: 'string', required: true },
    note: { type: 'string', required: true },
  },
}

function render(_args, value) {
  return [{ type: 'text', text: value.note }]
}

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

function serveFile(req, res, filePath, type, file) {
  let size
  try {
    size = statSync(filePath).size
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const download = url.searchParams.get('download') === '1' && !req.headers.range
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  }
  if (download) headers['content-disposition'] = `attachment; filename="${file}"`
  const range = download ? undefined : req.headers.range
  if (range) {
    const span = byteRange(range, size)
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
  const src = `/media/${file}?play=1`
  const save = `/media/${file}?download=1`
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Video</title>
<style>
  html,body{margin:0;height:100%;background:#111}
  body{display:grid;place-items:center}
  .stage{position:relative;width:min(100%,480px)}
  video{width:100%;max-height:100vh;background:#000;display:block}
  a{position:absolute;top:10px;right:10px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:999px;background:#fff;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.28)}
</style>
<div class="stage"><video controls autoplay playsinline src="${src}"></video><a href="${save}" download="${file}" aria-label="Tải về"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 1.8v7.6M5 7.2 8 10.2l3-3" fill="none" stroke="#1c1c1e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.2h10" fill="none" stroke="#1c1c1e" stroke-width="1.6" stroke-linecap="round"/></svg></a></div>
`
}

export function apply(ctx, config) {
  const store = {
    dir: config.mediaDir,
    url(file) { return `/media/${file}` },
  }
  mkdirSync(store.dir, { recursive: true })

  const registerRoute = (route) => {
    try {
      ctx.webServer.register(route)
    } catch (error) {
      if (!String(error?.message ?? error).includes('duplicate')) throw error
    }
  }

  registerRoute({
    kind: 'prefix',
    path: '/media/watch',
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

  registerRoute({
    kind: 'prefix',
    path: '/media',
    handler(req, res) {
      const file = basename(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (!FILE_NAME.test(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      serveFile(req, res, join(store.dir, file), contentType(file), file)
    },
  })

  ctx.tools.register(defineTool({
    name: 'speak',
    description: 'Turn text into speech with POST /v1/tts. voice_id defaults to eve. language is a BCP-47 code and defaults to en; use vi for Vietnamese. text may be at most 60000 characters. Returns an mp3 URL.',
    timeoutMs: 120000,
    parameters: {
      text: { type: 'string', required: true, description: 'Words to speak. At most 60000 characters.' },
      voice: { type: 'string', description: 'voice_id. Built-in: eve (default), ara, rex, sal, leo, and the other Grok voices. Custom voice ids are also accepted.' },
      language: { type: 'string', description: 'BCP-47 code: auto, en, vi, zh, ja, ko, fr, de, hi, id, it, ru, tr, bn, pt-BR, pt-PT, es-MX, es-ES, ar-EG, ar-SA, ar-AE. Defaults to en.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const text = args.text.trim()
      if (!text) throw new Error('text is empty')
      if (text.length > 60000) throw new Error('text must be at most 60000 characters')
      const voice = args.voice === undefined || args.voice === ''
        ? 'eve'
        : VOICES.includes(String(args.voice).toLowerCase())
          ? String(args.voice).toLowerCase()
          : /^[a-z0-9]{8}$/.test(String(args.voice))
            ? String(args.voice)
            : (() => { throw new Error(`voice must be a built-in voice or an 8-character custom voice_id`) })()
      const language = pick(args.language, LANGUAGES, 'en')
      const response = await xai('/v1/tts', {
        method: 'POST',
        signal: exec.signal,
        body: { text, voice_id: voice, language },
      })
      const url = await save(store, Buffer.from(await response.arrayBuffer()), 'mp3')
      return result('audio', url, `Spoken audio (${voice}, ${language}): ${url}`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_image',
    description: 'Create images via the Antigravity Image Executor (model: gemini-3.1-flash-image, requestType: image_gen on v1internal:generateContent) and display every result as a markdown image. Supports aspect_ratio (1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9) or size (1024x1024, 1536x1024, 1024x1536 -> reduced to 2:3).',
    timeoutMs: 180000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the image should show.' },
      model: { type: 'string', description: 'gemini-3.1-flash-image (default).' },
      n: { type: 'number', description: 'How many images to create, from 1 to 4. Defaults to 1.' },
      aspect_ratio: { type: 'string', description: '1:1 (default), 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9, or auto.' },
      size: { type: 'string', description: 'Optional size (1024x1024, 1536x1024, 1024x1536) reduced to aspect ratio.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (!prompt) throw new Error('prompt is empty')
      const count = args.n === undefined ? 1 : Math.min(Math.max(1, Number(args.n) || 1), 4)
      const aspectRatio = pick(args.aspect_ratio, IMAGE_ASPECT_RATIOS, undefined)
      const size = pick(args.size, IMAGE_SIZES, undefined)

      // Layer 1 (Bộ nối ảnh): chuẩn hóa thành gemini-3.1-flash-image-<ratio/size>
      const internalModelName = buildImageConnectorModelName(IMAGE_MODEL, aspectRatio, size)

      const urls = []
      for (let i = 0; i < count; i++) {
        // Layer 2 (Bộ thực thi Antigravity): tách hậu tố, gửi v1internal:generateContent với requestType: "image_gen"
        const responsePayload = await executeAntigravityImageGen({
          internalModelName,
          prompt,
          signal: exec.signal,
        })
        for (const item of responsePayload.data) {
          const ext = imageExtension(item.bytes)
          urls.push(await save(store, item.bytes, ext))
        }
      }
      if (urls.length === 0) throw new Error('The Antigravity image executor returned no valid image')
      return result('image', urls[0], urls.map((url) => `![image](${url})`).join('\n'))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'edit_image',
    description: 'Edit an existing image via the Antigravity Image Executor (model: gemini-3.1-flash-image, requestType: image_gen on v1internal:generateContent with reference inlineData in parts) and show the result as a markdown image. image_url can be a /media/... path or an https URL.',
    timeoutMs: 180000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'How to change the image.' },
      image_url: { type: 'string', required: true, description: '/media/... path or https URL of the reference image to edit.' },
      model: { type: 'string', description: 'gemini-3.1-flash-image (default).' },
      aspect_ratio: { type: 'string', description: 'Optional target aspect ratio (1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9).' },
      size: { type: 'string', description: 'Optional size (1024x1024, 1536x1024, 1024x1536) reduced to aspect ratio.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      const imageUrlInput = args.image_url.trim()
      if (!prompt) throw new Error('prompt is empty')
      if (!imageUrlInput) throw new Error('image_url is empty')
      const aspectRatio = pick(args.aspect_ratio, IMAGE_ASPECT_RATIOS, undefined)
      const size = pick(args.size, IMAGE_SIZES, undefined)
      const sourceImage = await readSourceImage(store, imageUrlInput, exec.signal)

      // Layer 1 (Bộ nối ảnh) -> Layer 2 (Bộ thực thi Antigravity)
      const internalModelName = buildImageConnectorModelName(IMAGE_MODEL, aspectRatio, size)
      const responsePayload = await executeAntigravityImageGen({
        internalModelName,
        prompt,
        sourceImage,
        signal: exec.signal,
      })

      const urls = []
      for (const item of responsePayload.data) {
        const ext = imageExtension(item.bytes)
        urls.push(await save(store, item.bytes, ext))
      }
      if (urls.length === 0) throw new Error('The Antigravity image edit executor returned no valid image')
      return result('image', urls[0], urls.map((url) => `Edited image: ![image](${url})`).join('\n'))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_video',
    description: 'Create a video with POST /v1/videos/generations, then poll GET /v1/videos/{request_id} until status is done.',
    timeoutMs: 240000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the video should show and how the camera moves.' },
      image_url: { type: 'string', description: 'Optional public https URL of a still image to animate.' },
      duration: { type: 'number', description: 'Length in seconds, an integer from 1 to 15. Defaults to 6.' },
      aspect_ratio: { type: 'string', description: 'Text-to-video only: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9, or 5:2.' },
      resolution: { type: 'string', description: '480p, 720p, or 1080p. Defaults to 480p when omitted.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (!prompt) throw new Error('prompt is empty')
      const duration = args.duration === undefined ? 6 : args.duration
      if (!Number.isInteger(duration) || duration < 1 || duration > 15) throw new Error('duration must be an integer from 1 to 15')
      const image = typeof args.image_url === 'string' && args.image_url.trim() ? args.image_url.trim() : undefined
      if (image !== undefined && !/^https:\/\//.test(image)) throw new Error('image_url must be an https URL')
      const aspectRatio = image === undefined ? pick(args.aspect_ratio, VIDEO_ASPECT_RATIOS, undefined) : undefined
      const resolution = pick(args.resolution, VIDEO_RESOLUTIONS, undefined)
      const started = await xai('/v1/videos/generations', {
        method: 'POST',
        signal: exec.signal,
        body: {
          model: VIDEO_MODEL,
          prompt,
          duration,
          ...(image === undefined ? {} : { image: { url: image } }),
          ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
          ...(resolution === undefined ? {} : { resolution }),
        },
      })
      const requestId = (await started.json()).request_id
      if (typeof requestId !== 'string' || !requestId) throw new Error('The video API returned no request id')
      const deadline = Date.now() + 210000
      let remote
      while (Date.now() < deadline) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000)
          exec.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('Cancelled'))
          }, { once: true })
        })
        const polled = await xai(`/v1/videos/${requestId}`, { signal: exec.signal })
        const payload = await polled.json()
        if (payload.status === 'done') {
          remote = payload.video?.url ?? payload.url
          break
        }
        if (payload.status === 'failed' || payload.status === 'expired') {
          throw new Error(`Video ${payload.status}`)
        }
      }
      if (!remote) throw new Error('The video was not ready in time')
      const url = await download(store, remote, 'mp4', exec.signal)
      const watch = url.replace(/\/media\//, '/media/watch/')
      return result('video', url, `Video (${duration}s): ${watch}`)
    },
  }))
}
