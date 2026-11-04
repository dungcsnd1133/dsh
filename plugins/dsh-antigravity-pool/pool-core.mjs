import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { createHash, randomBytes } from 'node:crypto';

// Paths are injected at init time so the same core runs on any machine.
// configurePaths() must be called before using POOL_FILE / CREDENTIALS_FILE.
export let DSH_HOME = '';
export let POOL_FILE = '';
export let CREDENTIALS_FILE = '';

export function configurePaths({ stateDir, credentialsFile } = {}) {
  DSH_HOME = stateDir || process.env.ANTIGRAVITY_POOL_STATE_DIR || '';
  if (!DSH_HOME) {
    throw new Error('[AntigravityPool] stateDir is required (cordis.patch.yml config or ANTIGRAVITY_POOL_STATE_DIR)');
  }
  fs.mkdirSync(DSH_HOME, { recursive: true });
  POOL_FILE = path.join(DSH_HOME, 'antigravity-pool.json');
  CREDENTIALS_FILE = credentialsFile || process.env.ANTIGRAVITY_CREDENTIALS_FILE || path.join(DSH_HOME, '.credentials.yaml');
  return { DSH_HOME, POOL_FILE, CREDENTIALS_FILE };
}

// Fetch is injectable so tests run offline.
let fetchImpl = globalThis.fetch.bind(globalThis);
export function setFetchImpl(fn) {
  fetchImpl = fn;
}
export function getFetch() {
  return fetchImpl;
}

// OAuth client credentials: environment variables take precedence, then a
// local oauth-client.json (mode 0600) saved from the UI. The file keeps the
// secret out of git and out of Railway variables; env still wins so deploys
// can override without editing the volume.
let OAUTH_CLIENT_FILE = '';

export function configureOAuthClientFile(file) {
  OAUTH_CLIENT_FILE = file || '';
}

function readStoredOAuthClient() {
  if (!OAUTH_CLIENT_FILE || !fs.existsSync(OAUTH_CLIENT_FILE)) return {};
  try {
    const doc = JSON.parse(fs.readFileSync(OAUTH_CLIENT_FILE, 'utf8'));
    return {
      clientId: typeof doc.clientId === 'string' ? doc.clientId : '',
      clientSecret: typeof doc.clientSecret === 'string' ? doc.clientSecret : '',
    };
  } catch {
    return {};
  }
}

// Read the effective OAuth client. Never log or return the secret to clients.
export function readAntigravityEnv() {
  const env = {
    clientId: process.env.ANTIGRAVITY_CLIENT_ID ?? '',
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET ?? '',
  };
  const stored = readStoredOAuthClient();
  return {
    clientId: env.clientId || stored.clientId || '',
    clientSecret: env.clientSecret || stored.clientSecret || '',
  };
}

// Where the current credentials came from, for the status endpoint.
export function oauthClientSource() {
  const env = {
    clientId: process.env.ANTIGRAVITY_CLIENT_ID ?? '',
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET ?? '',
  };
  if (env.clientId && env.clientSecret) return 'env';
  const stored = readStoredOAuthClient();
  if (stored.clientId && stored.clientSecret) return 'file';
  return 'none';
}

// Persist an OAuth client to the 0600 JSON file (UI "cấu hình OAuth" form).
export function saveOAuthClient({ clientId, clientSecret }) {
  if (!OAUTH_CLIENT_FILE) {
    throw new Error('[AntigravityPool] oauth client file path is not configured');
  }
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || !secret) throw new Error('clientId và clientSecret đều bắt buộc');
  if (!/\.apps\.googleusercontent\.com$/.test(id) && id.length < 20) {
    throw new Error('clientId không hợp lệ — phải có dạng …apps.googleusercontent.com');
  }
  fs.mkdirSync(path.dirname(OAUTH_CLIENT_FILE), { recursive: true });
  fs.writeFileSync(OAUTH_CLIENT_FILE, JSON.stringify({ clientId: id, clientSecret: secret }, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(OAUTH_CLIENT_FILE, 0o600);
  } catch {
    // best effort on filesystems without chmod
  }
  return { ok: true };
}

export function clearOAuthClient() {
  if (OAUTH_CLIENT_FILE && fs.existsSync(OAUTH_CLIENT_FILE)) fs.rmSync(OAUTH_CLIENT_FILE);
  return { ok: true };
}

export function isConfigured() {
  const { clientId, clientSecret } = readAntigravityEnv();
  return clientId.length > 0 && clientSecret.length > 0;
}

export const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback';
export const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];
export const ANTIGRAVITY_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

// The daily endpoint gates the Gemini quota group on the client version: a
// 1.x user agent only ever returns the "Claude and GPT" group. Antigravity IDE
// 2.24+ gets both, so probe with the same shape it sends.
export const ANTIGRAVITY_PROBE_USER_AGENT = 'antigravity/hub/2.24.0 darwin/arm64';
export const ANTIGRAVITY_IDE_HEADERS = {
  'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'Client-Metadata':
    '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
};

// RFC 7636 PKCE helpers — Google requires PKCE for installed-app flows.
export function makePkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Pending OAuth handshakes shared by every surface (standalone page and the
 * Settings card). A state token maps to the PKCE verifier plus the redirect URI
 * that must be replayed on the token exchange. Keeping one registry here means
 * a handshake started in Settings is completed by the /antigravity/oauth/callback
 * route, and vice versa.
 */
const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingHandshakes = new Map();

export function rememberHandshake(state, { codeVerifier, redirectUri }) {
  const now = Date.now();
  for (const [key, value] of pendingHandshakes) {
    if (now - value.createdAt > PENDING_TTL_MS) pendingHandshakes.delete(key);
  }
  pendingHandshakes.set(state, { codeVerifier, redirectUri, createdAt: now });
  return state;
}

export function takeHandshake(state) {
  const found = state ? pendingHandshakes.get(state) : undefined;
  if (!found) return undefined;
  pendingHandshakes.delete(state);
  if (Date.now() - found.createdAt > PENDING_TTL_MS) return undefined;
  return found;
}

export function handshakeCount() {
  return pendingHandshakes.size;
}

// Build the Google consent URL. redirectUri should be the OAuth client's
// registered URI (typically http://localhost:51121/oauth-callback) — the
// browser ends up there after consent and the user copies the full URL
// (it contains ?code=…) back into the pool UI.
export function buildAuthUrl({ redirectUri, state, codeChallenge } = {}) {
  const { clientId } = readAntigravityEnv();
  if (!clientId) {
    throw new Error('[AntigravityPool] ANTIGRAVITY_CLIENT_ID is not set in the environment');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri || ANTIGRAVITY_REDIRECT_URI,
    response_type: 'code',
    scope: ANTIGRAVITY_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (state) params.set('state', state);
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${ANTIGRAVITY_AUTH_URL}?${params.toString()}`;
}

// Exchange either ?code=… (auth-code flow) or the full callback URL the user
// pastes back. Returns a ready-to-store account object.
export async function exchangeCallback({ callbackUrlOrCode, redirectUri, codeVerifier, email, projectId }) {
  const { clientId, clientSecret } = readAntigravityEnv();
  if (!clientId || !clientSecret) {
    throw new Error('[AntigravityPool] ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET are not set in the environment');
  }
  let code = String(callbackUrlOrCode || '').trim();
  const m = /[?&]code=([^&\s]+)/.exec(code);
  if (m) code = decodeURIComponent(m[1]);
  if (!code) throw new Error('Không tìm thấy ?code=… trong URL/đoạn mã đã dán');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri || ANTIGRAVITY_REDIRECT_URI,
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);

  const res = await getFetch()(ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Đổi token thất bại (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Google không trả ' + (!data.access_token ? 'access_token' : 'refresh_token') + ' — thử lại với prompt=consent');
  }
  const account = addOrUpdateAccount({
    email: email || undefined,
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000 - 5 * 60 * 1000,
    projectId: projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
  });
  const pool = loadPool();
  pool.logs = pool.logs || [];
  pool.logs.push({
    timestamp: Date.now(),
    type: 'auth',
    message: `Đã thêm tài khoản qua link auth: ${account.email}`,
  });
  savePool(pool);
  return account;
}

export function readStoredCredentialsGrant() {
  try {
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
      email: typeof payload.email === 'string' && payload.email ? payload.email : 'primary@antigravity',
    };
  } catch {
    return null;
  }
}

export function writeStoredCredentialsGrant(account) {
  try {
    fs.mkdirSync(DSH_HOME, { recursive: true });
    let doc = { version: 1, records: {} };
    if (fs.existsSync(CREDENTIALS_FILE)) {
      try {
        const parsed = yaml.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') doc = parsed;
      } catch {
        // ignore corrupt yaml
      }
    }
    doc.version = 1;
    doc.records = doc.records || {};
    if (!account) {
      delete doc.records['llm-pi-ai/google'];
    } else {
      doc.records['llm-pi-ai/google'] = {
        kind: 'grant',
        payload: {
          type: 'oauth',
          access: account.access,
          refresh: account.refresh,
          expires: Math.floor(account.expires),
          projectId: account.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
          ...(account.email ? { email: account.email } : {}),
        },
      };
    }
    fs.writeFileSync(CREDENTIALS_FILE, yaml.stringify(doc), { mode: 0o600 });
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch (err) {
    console.error('[AntigravityPool] Failed to sync credentials to .credentials.yaml:', err);
  }
}

function defaultPoolState() {
  return {
    version: 1,
    strategy: 'quota-failover',
    retryOnQuota: true,
    cooldownMinutes: 30,
    activeIndex: 0,
    accounts: [],
    logs: [
      {
        timestamp: Date.now(),
        type: 'info',
        message: 'Khởi tạo hệ thống quản lý xoay vòng Antigravity đa tài khoản',
      },
    ],
  };
}

export function loadPool() {
  fs.mkdirSync(DSH_HOME, { recursive: true });
  let pool = defaultPoolState();

  if (fs.existsSync(POOL_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
      if (data && Array.isArray(data.accounts)) {
        pool = {
          ...pool,
          ...data,
          accounts: data.accounts.map((acc, idx) => ({
            id: acc.id || `acc_${idx}_${Date.now()}`,
            email: acc.email || `account_${idx + 1}@antigravity`,
            projectId: acc.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
            access: acc.access || '',
            refresh: acc.refresh || '',
            expires: Number(acc.expires || 0),
            addedAt: Number(acc.addedAt || Date.now()),
            lastUsedAt: Number(acc.lastUsedAt || 0),
            status: acc.status || 'active',
            quotaExceededUntil: acc.quotaExceededUntil ? Number(acc.quotaExceededUntil) : null,
            totalRequests: Number(acc.totalRequests || 0),
            quotaHits: Number(acc.quotaHits || 0),
            lastError: acc.lastError || null,
            lastQuota: acc.lastQuota && typeof acc.lastQuota === 'object' ? acc.lastQuota : null,
          })),
        };
      }
    } catch {
      // use default pool state
    }
  }

  // Bootstrap from .credentials.yaml if pool is empty
  if (pool.accounts.length === 0) {
    const existing = readStoredCredentialsGrant();
    if (existing && existing.access && existing.refresh) {
      pool.accounts.push({
        id: `acc_0_${Date.now()}`,
        email: existing.email || 'primary@antigravity',
        projectId: existing.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
        access: existing.access,
        refresh: existing.refresh,
        expires: existing.expires,
        addedAt: Date.now(),
        lastUsedAt: Date.now(),
        status: 'active',
        quotaExceededUntil: null,
        totalRequests: 0,
        quotaHits: 0,
        lastError: null,
      });
      pool.activeIndex = 0;
      savePool(pool);
    }
  }

  // Auto-recover expired cooldowns
  const now = Date.now();
  let changed = false;
  for (const acc of pool.accounts) {
    if (acc.status === 'cooldown' && acc.quotaExceededUntil && acc.quotaExceededUntil <= now) {
      acc.status = 'active';
      acc.quotaExceededUntil = null;
      changed = true;
    }
  }
  if (changed) {
    savePool(pool);
  }

  return pool;
}

export function savePool(pool) {
  try {
    fs.mkdirSync(DSH_HOME, { recursive: true });
    if (Array.isArray(pool.logs) && pool.logs.length > 100) {
      pool.logs = pool.logs.slice(-100);
    }
    fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('[AntigravityPool] Failed to save pool:', err);
  }
}

export function getSanitizedPoolView() {
  const pool = loadPool();
  const now = Date.now();
  const accounts = pool.accounts.map((acc, idx) => ({
    id: acc.id,
    email: acc.email,
    projectId: acc.projectId,
    expires: acc.expires,
    addedAt: acc.addedAt,
    lastUsedAt: acc.lastUsedAt,
    status: acc.status,
    isActive: idx === pool.activeIndex,
    quotaExceededUntil: acc.quotaExceededUntil,
    cooldownRemainingSec: acc.quotaExceededUntil && acc.quotaExceededUntil > now
      ? Math.ceil((acc.quotaExceededUntil - now) / 1000)
      : 0,
    totalRequests: acc.totalRequests || 0,
    quotaHits: acc.quotaHits || 0,
    lastError: acc.lastError || null,
    // Cached live quota from the last probe, so the list shows a percentage
    // immediately and the Quota action only refreshes it.
    lastQuota: acc.lastQuota && typeof acc.lastQuota === 'object'
      ? {
          percent: typeof acc.lastQuota.percent === 'number' ? acc.lastQuota.percent : null,
          bottleneck: typeof acc.lastQuota.bottleneck === 'string' ? acc.lastQuota.bottleneck : null,
          resetTime: typeof acc.lastQuota.resetTime === 'string' ? acc.lastQuota.resetTime : null,
          checkedAt: Number(acc.lastQuota.checkedAt || 0),
          ok: acc.lastQuota.ok !== false,
          ...(typeof acc.lastQuota.message === 'string' ? { message: acc.lastQuota.message } : {}),
        }
      : null,
  }));

  return {
    strategy: pool.strategy,
    retryOnQuota: pool.retryOnQuota,
    cooldownMinutes: pool.cooldownMinutes,
    activeIndex: pool.activeIndex,
    totalAccounts: accounts.length,
    totalHealthy: accounts.filter((a) => a.status === 'active').length,
    accounts,
    logs: (pool.logs || []).slice(-30).reverse(),
  };
}

export function isQuotaExceededError(statusOrError, text = '') {
  const status = typeof statusOrError === 'number' ? statusOrError : 0;
  const combined = `${String(statusOrError || '')} ${String(text || '')}`;
  if (status === 429) return true;
  return /quota|RESOURCE_EXHAUSTED|rateLimitExceeded|Too Many Requests/i.test(combined);
}

async function refreshAccountIfNeeded(acc) {
  if (!acc || !acc.refresh) return acc;
  if (Date.now() + 5 * 60 * 1000 < Number(acc.expires || 0)) {
    return acc;
  }
  const { clientId, clientSecret } = readAntigravityEnv();
  if (!clientId || !clientSecret) {
    throw new Error('[AntigravityPool] ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET are not set in the environment');
  }
  const res = await getFetch()(ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: acc.refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Refresh token failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Refresh response missing access_token');
  }
  acc.access = data.access_token;
  acc.refresh = data.refresh_token || acc.refresh;
  acc.expires = Date.now() + (data.expires_in || 3600) * 1000 - 5 * 60 * 1000;
  return acc;
}

export async function getActiveValidAccount(opts = {}) {
  const pool = loadPool();
  if (!pool.accounts.length) {
    return readStoredCredentialsGrant();
  }

  let idx = Number.isInteger(pool.activeIndex) && pool.activeIndex >= 0 && pool.activeIndex < pool.accounts.length
    ? pool.activeIndex
    : 0;

  if (opts?.rotateNext && pool.accounts.length > 1) {
    idx = (idx + 1) % pool.accounts.length;
  }

  for (let offset = 0; offset < pool.accounts.length; offset++) {
    const candidateIdx = (idx + offset) % pool.accounts.length;
    const acc = pool.accounts[candidateIdx];
    if (acc.status === 'cooldown' && acc.quotaExceededUntil && acc.quotaExceededUntil > Date.now()) {
      continue;
    }
    try {
      await refreshAccountIfNeeded(acc);
      acc.status = 'active';
      pool.activeIndex = candidateIdx;
      savePool(pool);
      writeStoredCredentialsGrant(acc);
      return acc;
    } catch (err) {
      acc.lastError = err instanceof Error ? err.message : String(err);
      savePool(pool);
    }
  }

  const fallback = pool.accounts[idx] || pool.accounts[0];
  if (fallback) {
    try {
      await refreshAccountIfNeeded(fallback);
      savePool(pool);
      writeStoredCredentialsGrant(fallback);
    } catch {
      // ignore
    }
    return fallback;
  }
  return null;
}

export async function handleAccountQuotaExceeded(idOrEmail, errorMessage = '') {
  const pool = loadPool();
  const idx = pool.accounts.findIndex((a) => a.id === idOrEmail || a.email === idOrEmail);
  if (idx === -1) return null;

  const acc = pool.accounts[idx];
  const cooldownMs = Math.max(1, Number(pool.cooldownMinutes || 30)) * 60 * 1000;
  acc.status = 'cooldown';
  acc.quotaExceededUntil = Date.now() + cooldownMs;
  acc.quotaHits = (acc.quotaHits || 0) + 1;
  acc.lastError = String(errorMessage || 'Quota exceeded').slice(0, 300);

  pool.logs = pool.logs || [];
  pool.logs.push({
    timestamp: Date.now(),
    type: 'quota',
    message: `Tài khoản ${acc.email} chạm giới hạn Quota, tạm nghỉ ${pool.cooldownMinutes || 30} phút`,
  });

  // Switch activeIndex to next healthy account
  for (let offset = 1; offset < pool.accounts.length; offset++) {
    const nextIdx = (idx + offset) % pool.accounts.length;
    const candidate = pool.accounts[nextIdx];
    if (candidate.status === 'active') {
      pool.activeIndex = nextIdx;
      writeStoredCredentialsGrant(candidate);
      break;
    }
  }

  savePool(pool);
  return acc;
}

export function recordAccountSuccess(idOrEmail) {
  const pool = loadPool();
  const acc = pool.accounts.find((a) => a.id === idOrEmail || a.email === idOrEmail);
  if (!acc) return;
  acc.status = 'active';
  acc.quotaExceededUntil = null;
  acc.lastUsedAt = Date.now();
  acc.totalRequests = (acc.totalRequests || 0) + 1;
  acc.lastError = null;
  savePool(pool);
}

export function addOrUpdateAccount(payload) {
  if (!payload || !payload.access || !payload.refresh) return null;
  const pool = loadPool();
  const email = payload.email || `account_${pool.accounts.length + 1}@antigravity`;
  let existing = pool.accounts.find((a) => a.email === email);
  if (existing) {
    existing.access = payload.access;
    existing.refresh = payload.refresh;
    existing.expires = Number(payload.expires || Date.now() + 3600 * 1000);
    existing.projectId = payload.projectId || existing.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID;
    existing.status = 'active';
    existing.quotaExceededUntil = null;
    existing.lastError = null;
  } else {
    existing = {
      id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email,
      projectId: payload.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
      access: payload.access,
      refresh: payload.refresh,
      expires: Number(payload.expires || Date.now() + 3600 * 1000),
      addedAt: Date.now(),
      lastUsedAt: Date.now(),
      status: 'active',
      quotaExceededUntil: null,
      totalRequests: 0,
      quotaHits: 0,
      lastError: null,
    };
    pool.accounts.push(existing);
    pool.activeIndex = pool.accounts.length - 1;
  }

  pool.logs = pool.logs || [];
  pool.logs.push({
    timestamp: Date.now(),
    type: 'auth',
    message: `Đã kết nối tài khoản Antigravity: ${email}`,
  });

  savePool(pool);
  writeStoredCredentialsGrant(existing);
  return existing;
}

export function removeAccount(idOrEmail) {
  const pool = loadPool();
  const idx = pool.accounts.findIndex((a) => a.id === idOrEmail || a.email === idOrEmail);
  if (idx === -1) return false;
  const [removed] = pool.accounts.splice(idx, 1);
  if (pool.activeIndex >= pool.accounts.length) {
    pool.activeIndex = Math.max(0, pool.accounts.length - 1);
  }
  const nextActive = pool.accounts[pool.activeIndex] || null;
  writeStoredCredentialsGrant(nextActive);
  pool.logs = pool.logs || [];
  pool.logs.push({
    timestamp: Date.now(),
    type: 'info',
    message: `Đã gỡ tài khoản ${removed.email}`,
  });
  savePool(pool);
  return true;
}

export function setActiveAccount(idOrEmail) {
  const pool = loadPool();
  const idx = pool.accounts.findIndex((a) => a.id === idOrEmail || a.email === idOrEmail);
  if (idx === -1) return null;
  pool.activeIndex = idx;
  const acc = pool.accounts[idx];
  acc.status = 'active';
  acc.quotaExceededUntil = null;
  writeStoredCredentialsGrant(acc);
  savePool(pool);
  return acc;
}

export function resetAccountQuota(idOrEmail) {
  const pool = loadPool();
  const acc = pool.accounts.find((a) => a.id === idOrEmail || a.email === idOrEmail);
  if (!acc) return null;
  acc.status = 'active';
  acc.quotaExceededUntil = null;
  acc.lastError = null;
  savePool(pool);
  return acc;
}

export function updatePoolConfig(partialConfig = {}) {
  const pool = loadPool();
  if (typeof partialConfig.strategy === 'string') {
    pool.strategy = partialConfig.strategy;
  }
  if (typeof partialConfig.retryOnQuota === 'boolean') {
    pool.retryOnQuota = partialConfig.retryOnQuota;
  }
  if (typeof partialConfig.cooldownMinutes === 'number' && partialConfig.cooldownMinutes > 0) {
    pool.cooldownMinutes = partialConfig.cooldownMinutes;
  }
  savePool(pool);
  return {
    strategy: pool.strategy,
    retryOnQuota: pool.retryOnQuota,
    cooldownMinutes: pool.cooldownMinutes,
  };
}

/**
 * Read the live quota picture for one account, or the whole pool.
 *
 * Cloud Code Assist answers `fetchAvailableModels` with a per-model
 * `quotaInfo.remainingFraction` and `resetTime`. The scarce resource is the
 * model the user actually chats with, so the headline number is the LOWEST
 * fraction across the chat models: one exhausted model is what returns 429,
 * not the average.
 * @param {string} [idOrEmail] - account to probe; every account when omitted.
 * @returns {Promise<Record<string, unknown>>} quota snapshot.
 */
/**
 * Ask `retrieveUserQuotaSummary` for the grouped limits Antigravity shows in its
 * own Models & Quota panel (one bucket per group and window, e.g. `gemini-weekly`,
 * `3p-5h`). This is the shape the app renders, and weekly limits appear ONLY
 * here — `fetchAvailableModels` cannot see them.
 * @param {string} access - bearer token for the account.
 * @param {string} project - Cloud Code Assist project id.
 * @returns {Promise<{ok: boolean, groups: Array<Record<string, unknown>>, reason?: string}>}
 */
export async function fetchQuotaSummary(access, project) {
  const bases = [
    'https://daily-cloudcode-pa.googleapis.com',
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
  ];
  let lastReason = 'no endpoint answered';
  for (const base of bases) {
    try {
      const res = await getFetch()(`${base}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json',
          'User-Agent': ANTIGRAVITY_PROBE_USER_AGENT,
          ...ANTIGRAVITY_IDE_HEADERS,
        },
        body: JSON.stringify({ project: project || ANTIGRAVITY_DEFAULT_PROJECT_ID }),
      });
      if (!res.ok) {
        lastReason = `HTTP ${res.status} from ${base}`;
        continue;
      }
      const data = await res.json();
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      // A 1.x-style response carries only the third-party group; treat an empty
      // or single-group result as usable but not authoritative.
      if (groups.length === 0) {
        lastReason = 'empty groups';
        continue;
      }
      return {
        ok: true,
        groups: groups.map((group) => ({
          name: typeof group?.displayName === 'string' ? group.displayName : 'Quota',
          description: typeof group?.description === 'string' ? group.description : '',
          buckets: (Array.isArray(group?.buckets) ? group.buckets : []).map((bucket) => ({
            id: typeof bucket?.bucketId === 'string' ? bucket.bucketId : '',
            label: typeof bucket?.displayName === 'string' ? bucket.displayName : '',
            window: typeof bucket?.window === 'string' ? bucket.window : '',
            percent:
              typeof bucket?.remainingFraction === 'number'
                ? Math.round(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100)
                : null,
            resetTime: typeof bucket?.resetTime === 'string' ? bucket.resetTime : null,
          })),
        })),
      };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, groups: [], reason: lastReason };
}

/**
 * List the models an account can use, with the per-model capability flags the
 * API exposes. Used by the quota panel and by the "which models" documentation.
 * @param {string} access - bearer token.
 * @param {string} project - project id.
 * @returns {Promise<{ok: boolean, models: Array<Record<string, unknown>>, reason?: string}>}
 */
export async function fetchModelCatalogue(access, project) {
  const bases = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://daily-cloudcode-pa.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
  ];
  let lastReason = 'no endpoint answered';
  for (const base of bases) {
    try {
      const res = await getFetch()(`${base}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json',
          'User-Agent': ANTIGRAVITY_PROBE_USER_AGENT,
          ...ANTIGRAVITY_IDE_HEADERS,
        },
        body: JSON.stringify({ project: project || ANTIGRAVITY_DEFAULT_PROJECT_ID }),
      });
      if (!res.ok) {
        lastReason = `HTTP ${res.status} from ${base}`;
        continue;
      }
      const data = await res.json();
      const raw = data?.models;
      if (!raw || typeof raw !== 'object') {
        lastReason = 'no models in response';
        continue;
      }
      const tiered = data?.tieredModelIds && typeof data.tieredModelIds === 'object' ? data.tieredModelIds : {};
      const tierOf = {};
      for (const [tier, ids] of Object.entries(tiered)) {
        if (Array.isArray(ids)) for (const id of ids) tierOf[id] = tier;
      }
      const models = Object.entries(raw).map(([id, model]) => ({
        id,
        name: typeof model?.displayName === 'string' && model.displayName ? model.displayName : id,
        images: model?.supportsImages === true,
        thinking: model?.supportsThinking === true,
        maxTokens: typeof model?.maxTokens === 'number' ? model.maxTokens : null,
        maxOutputTokens: typeof model?.maxOutputTokens === 'number' ? model.maxOutputTokens : null,
        recommended: model?.recommended === true,
        provider: typeof model?.modelProvider === 'string' ? model.modelProvider : '',
        tier: tierOf[id] ?? null,
        percent:
          typeof model?.quotaInfo?.remainingFraction === 'number'
            ? Math.round(Math.max(0, Math.min(1, model.quotaInfo.remainingFraction)) * 100)
            : null,
      }));
      models.sort((a, b) => a.id.localeCompare(b.id));
      return { ok: true, models };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, models: [], reason: lastReason };
}

export async function probeQuota(idOrEmail) {
  const pool = loadPool();
  const targets = idOrEmail
    ? pool.accounts.filter((a) => a.id === idOrEmail || a.email === idOrEmail)
    : pool.accounts.slice();
  if (targets.length === 0) {
    return { ok: false, checkedAt: Date.now(), accounts: [], message: 'Không tìm thấy tài khoản Antigravity.' };
  }
  const results = [];
  for (const acc of targets) {
    try {
      await refreshAccountIfNeeded(acc);
      const res = await getFetch()('https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${acc.access}`,
          'Content-Type': 'application/json',
          'User-Agent': ANTIGRAVITY_PROBE_USER_AGENT,
        },
        body: JSON.stringify({ project: acc.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        acc.lastQuota = { percent: null, bottleneck: null, resetTime: null, checkedAt: Date.now(), ok: false, message: `HTTP ${res.status}` };
        results.push({ id: acc.id, email: acc.email, ok: false, percent: null, message: `HTTP ${res.status}: ${detail.slice(0, 160)}` });
        continue;
      }
      const data = await res.json();
      const rows = [];
      for (const [id, model] of Object.entries(data?.models ?? {})) {
        const info = model?.quotaInfo;
        if (info === null || typeof info !== 'object') continue;
        const fraction = typeof info.remainingFraction === 'number' ? info.remainingFraction : null;
        rows.push({
          id,
          name: typeof model?.displayName === 'string' && model.displayName.length > 0 ? model.displayName : id,
          fraction,
          percent: fraction === null ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100),
          resetTime: typeof info.resetTime === 'string' ? info.resetTime : null,
        });
      }
      // Prefer the chat models this DSH profile actually offers.
      const tracked = rows.filter((row) => /^gemini-(4-argon|3\.8-flash|3-flash|3\.1-flash)/i.test(row.id));
      const candidates = tracked.length > 0 ? tracked : rows.filter((row) => row.fraction !== null);
      const scored = candidates.filter((row) => typeof row.fraction === 'number');
      const worst = scored.length > 0 ? scored.reduce((low, row) => (row.fraction < low.fraction ? row : low)) : null;
      const resetTime = scored.map((row) => row.resetTime).filter(Boolean).sort()[0] ?? null;
      // The grouped summary is what Antigravity itself renders (and the only
      // place weekly limits show up); per-model rows stay as the detail view.
      const summary = await fetchQuotaSummary(acc.access, acc.projectId);
      acc.lastQuota = {
        percent: worst === null ? null : worst.percent,
        bottleneck: worst === null ? null : worst.name,
        resetTime,
        checkedAt: Date.now(),
        ok: true,
        groups: summary.ok ? summary.groups : [],
      };
      results.push({
        id: acc.id,
        email: acc.email,
        ok: true,
        percent: acc.lastQuota.percent,
        bottleneck: acc.lastQuota.bottleneck,
        resetTime,
        groups: acc.lastQuota.groups,
        models: rows.sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101)),
      });
    } catch (err) {
      acc.lastQuota = { percent: null, bottleneck: null, resetTime: null, checkedAt: Date.now(), ok: false, message: err instanceof Error ? err.message : String(err) };
      results.push({ id: acc.id, email: acc.email, ok: false, percent: null, message: err instanceof Error ? err.message : String(err) });
    }
  }
  savePool(pool);
  return { ok: true, checkedAt: Date.now(), accounts: results };
}

export async function testAccountQuota(idOrEmail) {
  const pool = loadPool();
  const acc = idOrEmail
    ? pool.accounts.find((a) => a.id === idOrEmail || a.email === idOrEmail)
    : pool.accounts[pool.activeIndex] || pool.accounts[0];
  if (!acc) {
    return { ok: false, message: 'Không tìm thấy tài khoản Antigravity để kiểm tra.' };
  }
  try {
    await refreshAccountIfNeeded(acc);
    const res = await getFetch()('https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${acc.access}`,
        'Content-Type': 'application/json',
        'User-Agent': ANTIGRAVITY_PROBE_USER_AGENT,
      },
      body: JSON.stringify({ project: acc.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, message: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }
    acc.status = 'active';
    acc.quotaExceededUntil = null;
    acc.lastError = null;
    savePool(pool);
    return { ok: true, message: `Tài khoản ${acc.email} hoạt động tốt.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
