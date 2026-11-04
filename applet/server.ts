import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'yaml';
import { spawn, execFileSync } from 'node:child_process';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  loadPool,
  savePool,
  getSanitizedPoolView,
  getActiveValidAccount,
  handleAccountQuotaExceeded,
  recordAccountSuccess,
  addOrUpdateAccount,
  removeAccount,
  setActiveAccount,
  resetAccountQuota,
  updatePoolConfig,
  testAccountQuota,
  isQuotaExceededError,
  // @ts-ignore
} from './antigravity-pool.mjs';

const PORT = 3000;
const DSH_PORT = 3082;
const DSH_HOST = '127.0.0.1';
const DSH_TARGET = `http://${DSH_HOST}:${DSH_PORT}`;
const WORKSPACE_ROOT = '/app/applet';
const DSH_HOME = path.join(WORKSPACE_ROOT, '.dsh-home');
const CREDENTIALS_FILE = path.join(DSH_HOME, '.credentials.yaml');

const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ?? '';
const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET ?? '';
const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback';
const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];
const ANTIGRAVITY_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

function killExistingDshProcesses() {
  try {
    const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x));
    for (const pid of pids) {
      const numPid = Number(pid);
      if (numPid === process.pid || numPid === process.ppid) continue;
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
        if (cmd.includes('node_modules') && cmd.includes('dsh') && cmd.includes('superagent')) {
          console.log(`[DSH Launcher] Stopping previous DSH process PID ${pid}`);
          process.kill(numPid, 'SIGKILL');
        }
      } catch {
        // ignore exited process
      }
    }
  } catch {
    // ignore if /proc unavailable
  }
}

function cleanStaleLockFiles(dir: string) {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name.endsWith('.lock') || entry.name === 'LOCK') {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`[DSH Launcher] Removed stale lock: ${fullPath}`);
        } catch {
          // ignore
        }
      } else if (entry.isDirectory()) {
        cleanStaleLockFiles(fullPath);
      }
    }
  } catch {
    // ignore
  }
}

function ensurePluginSymlinks() {
  const nodeModulesRoot = path.join(WORKSPACE_ROOT, 'node_modules');
  const localScopeDir = path.join(nodeModulesRoot, '@local');
  fs.mkdirSync(localScopeDir, { recursive: true });

  const links: Array<[string, string]> = [
    [path.join(localScopeDir, 'dsh-context-auto'), path.join(WORKSPACE_ROOT, 'dsh-repo/plugins/dsh-context-auto')],
    [path.join(localScopeDir, 'dsh-media-play'), path.join(WORKSPACE_ROOT, 'dsh-repo/plugins/dsh-media-play')],
    [path.join(localScopeDir, 'hide-session-memory-hud'), path.join(WORKSPACE_ROOT, 'dsh-repo/plugins/hide-session-memory-hud')],
    [path.join(localScopeDir, 'dsh-antigravity-pool'), path.join(WORKSPACE_ROOT, 'dsh-repo/plugins/dsh-antigravity-pool')],
    [path.join(nodeModulesRoot, 'dsh-media'), path.join(WORKSPACE_ROOT, 'dsh-repo/plugins/dsh-media')],
    [path.join(nodeModulesRoot, 'dsh-video-watch'), path.join(WORKSPACE_ROOT, 'dsh-repo/plugins/dsh-video-watch')],
    [path.join(nodeModulesRoot, 'dsh-superagent'), path.join(WORKSPACE_ROOT, 'dsh-repo/dsh-superagent')],
  ];

  for (const [linkPath, targetPath] of links) {
    if (!fs.existsSync(targetPath)) continue;
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink() || stat.isDirectory()) continue;
      fs.rmSync(linkPath, { recursive: true, force: true });
    } catch {
      // does not exist yet
    }
    try {
      fs.symlinkSync(targetPath, linkPath, 'dir');
      console.log(`[DSH Launcher] Restored plugin symlink: ${linkPath} -> ${targetPath}`);
    } catch (err) {
      console.warn(`[DSH Launcher] Failed to symlink ${linkPath}:`, err);
    }
  }

  const profileNodeModules = path.join(DSH_HOME, 'profiles/superagent/node_modules');
  try {
    if (!fs.existsSync(profileNodeModules)) {
      fs.symlinkSync(nodeModulesRoot, profileNodeModules, 'dir');
    }
  } catch {
    // ignore
  }
}

function ensureNativePatchApplied() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.chmodSync(CREDENTIALS_FILE, 0o600);
    }
    ensurePluginSymlinks();
    const patchScript = path.join(WORKSPACE_ROOT, 'dsh-repo/plugins/dsh-context-auto/patch-native.mjs');
    const nodeModulesRoot = path.join(WORKSPACE_ROOT, 'node_modules');
    if (fs.existsSync(patchScript)) {
      execFileSync(process.execPath, [patchScript, '--root', nodeModulesRoot, '--apply'], {
        stdio: 'inherit',
      });
    }
    const sessionPatch = path.join(WORKSPACE_ROOT, 'patch-aistudio-session.mjs');
    if (fs.existsSync(sessionPatch)) {
      execFileSync(process.execPath, [sessionPatch], {
        stdio: 'inherit',
      });
    }
  } catch (err) {
    console.warn('[DSH Launcher] Native patch check warning:', err);
  }
}

interface AntigravityGrantPayload {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  projectId: string;
  email?: string;
}

function readStoredAntigravityGrant(): AntigravityGrantPayload | null {
  try {
    const pool = loadPool() as any;
    const acc = (pool?.accounts?.[pool?.activeIndex] || pool?.accounts?.[0]) as any;
    if (acc && acc.access && acc.refresh) {
      return {
        type: 'oauth',
        access: acc.access,
        refresh: acc.refresh,
        expires: acc.expires,
        projectId: acc.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
        email: acc.email,
      };
    }
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const doc = yaml.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const payload = doc?.records?.['llm-pi-ai/google']?.payload;
    if (!payload || typeof payload.access !== 'string' || typeof payload.refresh !== 'string') {
      return null;
    }
    return {
      type: 'oauth',
      access: payload.access,
      refresh: payload.refresh,
      expires: Number(payload.expires || 0),
      projectId: typeof payload.projectId === 'string' && payload.projectId ? payload.projectId : ANTIGRAVITY_DEFAULT_PROJECT_ID,
      ...(typeof payload.email === 'string' && payload.email ? { email: payload.email } : {}),
    };
  } catch {
    return null;
  }
}

function writeStoredAntigravityGrant(payload: AntigravityGrantPayload | null) {
  if (payload) {
    addOrUpdateAccount(payload);
  }
  fs.mkdirSync(DSH_HOME, { recursive: true });
  let doc: any = { version: 1, records: {} };
  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const parsed = yaml.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') doc = parsed;
    } catch {
      // start fresh if corrupt
    }
  }
  doc.version = 1;
  doc.records = doc.records || {};
  if (!payload) {
    delete doc.records['llm-pi-ai/google'];
  } else {
    doc.records['llm-pi-ai/google'] = {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: payload.access,
        refresh: payload.refresh,
        expires: Math.floor(payload.expires),
        projectId: payload.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
        ...(payload.email ? { email: payload.email } : {}),
      },
    };
  }
  fs.writeFileSync(CREDENTIALS_FILE, yaml.stringify(doc), { mode: 0o600 });
  fs.chmodSync(CREDENTIALS_FILE, 0o600);
}

async function getValidAntigravityGrant(): Promise<AntigravityGrantPayload | null> {
  const acc = (await getActiveValidAccount()) as any;
  if (acc && acc.access) {
    return {
      type: 'oauth',
      access: acc.access,
      refresh: acc.refresh,
      expires: acc.expires,
      projectId: acc.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
      email: acc.email,
    };
  }
  const grant = readStoredAntigravityGrant();
  if (!grant) return null;
  if (Date.now() + 5 * 60 * 1000 < grant.expires) {
    return grant;
  }
  const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: grant.refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Refresh token failed (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as any;
  if (!data.access_token) {
    throw new Error('Refresh response missing access_token');
  }
  const updated: AntigravityGrantPayload = {
    type: 'oauth',
    access: data.access_token,
    refresh: data.refresh_token || grant.refresh,
    expires: Date.now() + (data.expires_in || 3600) * 1000 - 5 * 60 * 1000,
    projectId: grant.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
    ...(grant.email ? { email: grant.email } : {}),
  };
  writeStoredAntigravityGrant(updated);
  return updated;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function buildInternalImageModelName(model?: string, aspectRatio?: string, size?: string): string {
  const base = (model || 'gemini-3.1-flash-image').trim();
  if (size && size !== 'auto' && /^\d+x\d+$/i.test(size.trim())) {
    return `${base}-${size.trim().toLowerCase()}`;
  }
  if (aspectRatio && aspectRatio !== 'auto') {
    return `${base}-${aspectRatio.trim().replace(':', 'x')}`;
  }
  return base;
}

function parseAntigravityImageModelAndRatio(internalModelName: string): { upstreamModel: string; aspectRatio: string } {
  const match = /^(gemini-[a-z0-9.-]+-image)(?:-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?))?$/i.exec(internalModelName.trim());
  if (!match) {
    return { upstreamModel: 'gemini-3.1-flash-image', aspectRatio: '1:1' };
  }
  const upstreamModel = match[1];
  const rawW = match[2];
  const rawH = match[3];
  if (!rawW || !rawH) {
    return { upstreamModel, aspectRatio: '1:1' };
  }
  const w = Number(rawW);
  const h = Number(rawH);
  if (Number.isInteger(w) && Number.isInteger(h) && w >= 64 && h >= 64) {
    const divisor = gcd(w, h);
    return { upstreamModel, aspectRatio: `${w / divisor}:${h / divisor}` };
  }
  return { upstreamModel, aspectRatio: `${rawW}:${rawH}` };
}

function isValidImageBuffer(bytes: Buffer): boolean {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return true;
  if (bytes.subarray(0, 3).toString() === 'GIF') return true;
  return false;
}

const pendingPkce = new Map<string, { verifier: string; createdAt: number }>();
let latestVerifier = '';

function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function parseCallbackInput(input: string): { code?: string; state?: string } {
  const value = (input || '').trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // not a full URL
  }
  if (value.includes('code=')) {
    const qIdx = value.indexOf('?');
    const params = new URLSearchParams(qIdx >= 0 ? value.slice(qIdx + 1) : value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }
  return { code: value };
}

async function discoverProject(accessToken: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'X-Goog-Api-Client': 'gl-node/22.17.0',
    'Client-Metadata': JSON.stringify({
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    }),
  };
  for (const endpoint of [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
  ]) {
    try {
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject) {
          return data.cloudaicompanionProject;
        }
        if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject.id === 'string') {
          return data.cloudaicompanionProject.id;
        }
      }
    } catch {
      // try next
    }
  }
  return ANTIGRAVITY_DEFAULT_PROJECT_ID;
}

async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      return typeof data.email === 'string' ? data.email : undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

let authCookie = '';
let dshReady = false;
let launchUrl = '';

async function exchangeLaunchToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: DSH_HOST,
        port: DSH_PORT,
        path: `/?token=${encodeURIComponent(token)}`,
        method: 'GET',
        headers: {
          Host: `${DSH_HOST}:${DSH_PORT}`,
        },
      },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie.length > 0) {
          authCookie = setCookie.map((c) => c.split(';')[0]).join('; ');
          dshReady = true;
          console.log(`[DSH Launcher] Authenticated session cookie acquired (${authCookie.slice(0, 24)}...)`);
        }
        res.resume();
        resolve();
      }
    );
    req.on('error', (err) => {
      console.error('[DSH Launcher] Token exchange error:', err.message);
      resolve();
    });
    req.end();
  });
}

function startDshProcess() {
  killExistingDshProcesses();
  cleanStaleLockFiles(DSH_HOME);
  ensureNativePatchApplied();

  const dshBin = path.join(WORKSPACE_ROOT, 'node_modules/.bin/dsh');
  const child = spawn(
    dshBin,
    [
      '--profile',
      'superagent',
      '--no-open',
      '--public-url',
      'https://agent.hoantienmuasam.net/',
      '--trusted-host',
      'agent.hoantienmuasam.net',
    ],
    {
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        DSH_HOME,
        TLPRO_API_KEY: process.env.TLPRO_API_KEY || 'sk-tlpro-3150707a162cfb8cd2e4cf97f673a8f23dc09342',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdoutBuf = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    process.stdout.write(`[dsh] ${text}`);
    stdoutBuf += text;
    const match = /dsh web:\s*(https?:\/\/[^\s]+\?token=([A-Za-z0-9_-]+))/.exec(stdoutBuf);
    if (match && !authCookie) {
      launchUrl = match[1];
      const token = match[2];
      void exchangeLaunchToken(token);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[dsh:err] ${chunk.toString('utf8')}`);
  });

  child.on('exit', (code, signal) => {
    console.log(`[DSH Launcher] dsh exited with code ${code} (signal: ${signal})`);
    dshReady = false;
    authCookie = '';
    if (signal !== 'SIGKILL' && signal !== 'SIGTERM') {
      setTimeout(() => {
        console.log('[DSH Launcher] Auto-restarting DSH process...');
        startDshProcess();
      }, 2000);
    }
  });

  return child;
}

startDshProcess();

const app = express();
app.use('/api/antigravity', express.json({ limit: '25mb' }));
app.use('/v1/images', express.json({ limit: '25mb' }));

app.get('/__dsh_kit_status', (_req, res) => {
  const grant = readStoredAntigravityGrant();
  res.json({
    repository: 'dungcsnd1133/dsh',
    dshVersion: '0.2.1-rc.5',
    contextAutoVersion: '1.1.2',
    dshReady,
    authenticated: Boolean(authCookie),
    antigravityConnected: Boolean(grant),
    antigravityEmail: grant?.email ?? null,
    launchUrl: launchUrl ? launchUrl.replace(/token=[^&]+/, 'token=REDACTED') : null,
  });
});

app.get('/api/antigravity/status', (_req, res) => {
  const grant = readStoredAntigravityGrant();
  const pool = getSanitizedPoolView();
  res.json({
    connected: Boolean(grant),
    email: grant?.email ?? null,
    projectId: grant?.projectId ?? null,
    expires: grant?.expires ?? null,
    models: ['gemini-4-argon', 'gemini-3.8-flash'],
    imageModels: ['gemini-3.1-flash-image'],
    totalAccounts: pool.totalAccounts,
    totalHealthy: pool.totalHealthy,
    strategy: pool.strategy,
  });
});

app.get('/api/antigravity/pool', (_req, res) => {
  res.json(getSanitizedPoolView());
});

app.post('/api/antigravity/pool/strategy', (req, res) => {
  const config = updatePoolConfig(req.body);
  res.json({ ok: true, config, pool: getSanitizedPoolView() });
});

app.post('/api/antigravity/pool/select', (req, res) => {
  const target = req.body?.id || req.body?.email;
  const acc = setActiveAccount(target);
  res.json({ ok: Boolean(acc), account: acc, pool: getSanitizedPoolView() });
});

app.post('/api/antigravity/pool/delete', (req, res) => {
  const target = req.body?.id || req.body?.email;
  const ok = removeAccount(target);
  res.json({ ok, pool: getSanitizedPoolView() });
});

app.post('/api/antigravity/pool/reset-quota', (req, res) => {
  const target = req.body?.id || req.body?.email;
  const acc = resetAccountQuota(target);
  res.json({ ok: Boolean(acc), account: acc, pool: getSanitizedPoolView() });
});

app.post('/api/antigravity/pool/test', async (req, res) => {
  try {
    const target = req.body?.id || req.body?.email;
    const result = await testAccountQuota(target);
    res.json({ ...result, pool: getSanitizedPoolView() });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || String(err), pool: getSanitizedPoolView() });
  }
});

/**
 * OpenAI-compatible 2-layer Antigravity Image Generation & Editing endpoints:
 * POST /v1/images/generations
 * POST /v1/images/edits
 */
async function handleAntigravityImageHttp(req: express.Request, res: express.Response) {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ error: { message: 'prompt is required' } });
      return;
    }
    const rawModel = String(req.body?.model || 'gemini-3.1-flash-image');
    const aspectRatio = typeof req.body?.aspect_ratio === 'string' ? req.body.aspect_ratio : undefined;
    const size = typeof req.body?.size === 'string' ? req.body.size : undefined;

    // Layer 1: Bộ nối ảnh -> chuẩn hóa hậu tố tỷ lệ/kích thước
    const internalModelName = buildInternalImageModelName(rawModel, aspectRatio, size);
    // Layer 2: Bộ thực thi Antigravity -> tách model và tỷ lệ
    const { upstreamModel, aspectRatio: resolvedRatio } = parseAntigravityImageModelAndRatio(internalModelName);

    const parts: any[] = [];
    const refImage = req.body?.image;
    if (typeof refImage === 'string' && refImage.trim()) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: refImage.trim().replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ''),
        },
      });
    } else if (refImage && typeof refImage === 'object' && typeof refImage.url === 'string') {
      const imgRes = await fetch(refImage.url);
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        parts.push({
          inlineData: {
            mimeType: imgRes.headers.get('content-type') || 'image/png',
            data: buf.toString('base64'),
          },
        });
      }
    }
    parts.push({ text: prompt });

    const pool = loadPool() as any;
    const maxAttempts = Math.max(1, (pool?.accounts?.length || 1));
    const triedAccounts = new Set<string>();
    let lastErrorText = '';
    let lastStatus = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const grant = (await getActiveValidAccount({ rotateNext: attempt > 0 || pool?.strategy === 'round-robin' })) as any;
      if (!grant) {
        break;
      }
      if (triedAccounts.has(grant.id)) continue;
      triedAccounts.add(grant.id);

      const requestBody = {
        project: grant.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
        model: upstreamModel,
        userAgent: 'antigravity',
        requestType: 'image_gen',
        requestId: `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        request: {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 1,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
            imageConfig: {
              aspectRatio: resolvedRatio,
            },
          },
          sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : `sess-${Date.now()}`,
        },
      };

      const upstreamRes = await fetch('https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${grant.access}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/1.15.8 darwin/arm64',
          'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
          'Client-Metadata': JSON.stringify({
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          }),
        },
        body: JSON.stringify(requestBody),
      });

      if (!upstreamRes.ok) {
        lastStatus = upstreamRes.status;
        lastErrorText = await upstreamRes.text().catch(() => '');
        if (isQuotaExceededError(lastStatus, lastErrorText)) {
          console.warn(`[AntigravityImage] Account ${grant.email} hit quota (${lastStatus}): ${lastErrorText.slice(0, 150)}`);
          await handleAccountQuotaExceeded(grant.id, lastErrorText);
          if (pool?.retryOnQuota) {
            continue; // retry next account
          }
        }
        res.status(lastStatus).json({ error: { message: `Antigravity generateContent failed (${lastStatus}): ${lastErrorText}` } });
        return;
      }

      recordAccountSuccess(grant.id);
      const json = (await upstreamRes.json()) as any;
      const candidateParts: any[] =
        json?.candidates?.[0]?.content?.parts ??
        json?.response?.candidates?.[0]?.content?.parts ??
        [];

      const data: Array<{ b64_json: string }> = [];
      for (const part of candidateParts) {
        const b64 = part?.inlineData?.data;
        if (typeof b64 !== 'string' || !b64.trim()) continue;
        const cleanB64 = b64.trim();
        const decoded = Buffer.from(cleanB64, 'base64');
        if (!isValidImageBuffer(decoded)) continue;
        data.push({ b64_json: cleanB64 });
      }

      if (data.length === 0) {
        res.status(502).json({
          error: {
            message: 'Antigravity returned HTTP 200 but no valid decodable image data in candidates[0].content.parts',
          },
        });
        return;
      }

      res.json({
        created: Math.floor(Date.now() / 1000),
        data,
      });
      return;
    }

    res.status(lastStatus || 401).json({
      error: { message: `Tất cả tài khoản Antigravity đều cạn Quota hoặc chưa kết nối. (${lastStatus}): ${lastErrorText}` },
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err?.message || String(err) } });
  }
}

app.post('/v1/images/generations', handleAntigravityImageHttp);
app.post('/v1/images/edits', handleAntigravityImageHttp);

app.post('/api/antigravity/auth-url', (_req, res) => {
  const { verifier, challenge } = generatePkcePair();
  const state = crypto.randomBytes(16).toString('hex');
  pendingPkce.set(state, { verifier, createdAt: Date.now() });
  latestVerifier = verifier;

  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: ANTIGRAVITY_REDIRECT_URI,
    scope: ANTIGRAVITY_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.json({
    authUrl: `${ANTIGRAVITY_AUTH_URL}?${params.toString()}`,
    state,
    redirectUri: ANTIGRAVITY_REDIRECT_URI,
  });
});

app.post('/api/antigravity/exchange', async (req, res) => {
  try {
    const rawInput = String(req.body?.input || '').trim();
    const fallbackState = String(req.body?.state || '').trim();
    const parsed = parseCallbackInput(rawInput);
    const code = parsed.code;
    if (!code) {
      res.status(400).json({ error: 'Không tìm thấy mã code trong URL hoặc chuỗi bạn dán.' });
      return;
    }
    const stateKey = parsed.state || fallbackState;
    const pkceEntry = (stateKey ? pendingPkce.get(stateKey) : undefined) || (latestVerifier ? { verifier: latestVerifier } : undefined);
    if (!pkceEntry?.verifier) {
      res.status(400).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng bấm bước 1 để tạo link đăng nhập mới.' });
      return;
    }

    const tokenRes = await fetch(ANTIGRAVITY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ANTIGRAVITY_REDIRECT_URI,
        code_verifier: pkceEntry.verifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      res.status(400).json({ error: `Đổi mã OAuth thất bại (${tokenRes.status}): ${errText}` });
      return;
    }

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenData.access_token || !tokenData.refresh_token) {
      res.status(400).json({ error: 'Phản hồi OAuth thiếu access_token hoặc refresh_token.' });
      return;
    }

    const [email, projectId] = await Promise.all([
      fetchUserEmail(tokenData.access_token),
      discoverProject(tokenData.access_token),
    ]);

    const payload: AntigravityGrantPayload = {
      type: 'oauth',
      access: tokenData.access_token,
      refresh: tokenData.refresh_token,
      expires: Date.now() + (tokenData.expires_in || 3600) * 1000 - 5 * 60 * 1000,
      projectId: projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
      ...(email ? { email } : {}),
    };

    const addedAcc = addOrUpdateAccount(payload);
    writeStoredAntigravityGrant(payload);
    if (stateKey) pendingPkce.delete(stateKey);

    res.json({
      ok: true,
      connected: true,
      email: (addedAcc as any)?.email ?? payload.email ?? null,
      projectId: (addedAcc as any)?.projectId ?? payload.projectId,
      expires: (addedAcc as any)?.expires ?? payload.expires,
      pool: getSanitizedPoolView(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/api/antigravity/logout', (req, res) => {
  const target = req.body?.id || req.body?.email;
  if (target) {
    removeAccount(target);
  } else {
    writeStoredAntigravityGrant(null);
  }
  res.json({ ok: true, pool: getSanitizedPoolView() });
});

app.get('/__antigravity_ui.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.send(`(function () {
  var el = document.getElementById('ag-topbar-root');
  if (el && el.parentNode) el.parentNode.removeChild(el);
  var modal = document.getElementById('ag-modal-backdrop');
  if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
})();`);
});

const proxy = createProxyMiddleware({
  target: DSH_TARGET,
  changeOrigin: false,
  ws: true,
  on: {
    proxyReq: (proxyReq, req) => {
      proxyReq.setHeader('host', `${DSH_HOST}:${DSH_PORT}`);
      if (req.headers.origin) {
        proxyReq.setHeader('origin', DSH_TARGET);
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        proxyReq.setHeader('sec-fetch-site', 'same-origin');
      }
      if (authCookie) {
        const existing = req.headers.cookie;
        proxyReq.setHeader('cookie', existing ? `${existing}; ${authCookie}` : authCookie);
      }
    },
    proxyReqWs: (proxyReq, req) => {
      proxyReq.setHeader('host', `${DSH_HOST}:${DSH_PORT}`);
      if (req.headers.origin) {
        proxyReq.setHeader('origin', DSH_TARGET);
      }
      if (authCookie) {
        const existing = req.headers.cookie;
        proxyReq.setHeader('cookie', existing ? `${existing}; ${authCookie}` : authCookie);
      }
    },
    proxyRes: (proxyRes) => {
      delete proxyRes.headers['x-frame-options'];
    },
  },
});

app.use((req, res, next) => {
  if (!dshReady) {
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="2" />
  <title>Đang khởi động DSH Superagent...</title>
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; background: #0f172a; color: #f8fafc; font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
    .box { text-align: center; padding: 24px 32px; border: 1px solid #1e293b; border-radius: 12px; background: #020617; }
    .sub { color: #94a3b8; font-size: 13px; margin-top: 8px; font-family: "JetBrains Mono", monospace; }
  </style>
</head>
<body>
  <div class="box">
    <div><strong>Đang khởi động DSH Superagent...</strong></div>
    <div class="sub">Google Antigravity · gemini-4-argon · gemini-3.8-flash · gemini-3.1-flash-image</div>
  </div>
</body>
</html>`);
    return;
  }
  return proxy(req, res, next);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DSH Gateway] Listening on http://0.0.0.0:${PORT} -> proxying to ${DSH_TARGET}`);
});

server.on('upgrade', (req, socket, head) => {
  proxy.upgrade(req, socket as any, head);
});
