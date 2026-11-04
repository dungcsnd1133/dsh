import fs from 'node:fs';
import path from 'node:path';

// Paths default to the DSH runtime layout; override with --root.
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const DSH_NODE_MODULES = argRoot
  ? path.resolve(argRoot)
  : '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules';
const DRY = process.argv.includes('--dry-run');
// Every write goes through wf() so --dry-run can preview without touching the runtime.
const wf = (file, data, opts) => {
  if (DRY) {
    console.log(`[dry-run] would write ${file} (${String(data).length} bytes)`);
    return;
  }
  fs.writeFileSync(file, data, opts);
};
// 1. Write /node_modules/@earendil-works/pi-ai/dist/auth/oauth/google-antigravity.js
const oauthFile = path.join(DSH_NODE_MODULES, '@earendil-works/pi-ai/dist/auth/oauth/google-antigravity.js');
const oauthCode = `import { randomBytes } from "node:crypto";
import { startOAuthCallbackServer, waitForCallbackOrManualInput } from "./callback-server.js";
import { generatePKCE } from "./pkce.js";

export const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ?? "";
export const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET ?? "";
export const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
export const ANTIGRAVITY_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
];
export const ANTIGRAVITY_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const ANTIGRAVITY_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

function parseAuthorizationInput(input) {
    const value = (input || "").trim();
    if (!value) return {};
    try {
        const url = new URL(value);
        return {
            code: url.searchParams.get("code") ?? undefined,
            state: url.searchParams.get("state") ?? undefined,
        };
    } catch {
        // not a full URL
    }
    if (value.includes("code=")) {
        const qIndex = value.indexOf("?");
        const params = new URLSearchParams(qIndex >= 0 ? value.slice(qIndex + 1) : value);
        return {
            code: params.get("code") ?? undefined,
            state: params.get("state") ?? undefined,
        };
    }
    return { code: value };
}

export async function discoverAntigravityProject(accessToken) {
    const headers = {
        Authorization: \`Bearer \${accessToken}\`,
        "Content-Type": "application/json",
        "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "X-Goog-Api-Client": "gl-node/22.17.0",
        "Client-Metadata": JSON.stringify({
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
        }),
    };
    const endpoints = [
        "https://daily-cloudcode-pa.sandbox.googleapis.com",
        "https://cloudcode-pa.googleapis.com",
    ];
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(\`\${endpoint}/v1internal:loadCodeAssist\`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    metadata: {
                        ideType: "IDE_UNSPECIFIED",
                        platform: "PLATFORM_UNSPECIFIED",
                        pluginType: "GEMINI",
                    },
                }),
            });
            if (response.ok) {
                const data = await response.json();
                if (typeof data.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
                    return data.cloudaicompanionProject;
                }
                if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject.id === "string") {
                    return data.cloudaicompanionProject.id;
                }
            }
        } catch {
            // ignore and try next endpoint
        }
    }
    return ANTIGRAVITY_DEFAULT_PROJECT_ID;
}

export async function fetchAntigravityUserEmail(accessToken) {
    try {
        const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
            headers: { Authorization: \`Bearer \${accessToken}\` },
        });
        if (response.ok) {
            const data = await response.json();
            return typeof data.email === "string" ? data.email : undefined;
        }
    } catch {
        // ignore
    }
    return undefined;
}

export async function exchangeAntigravityCode(code, verifier, signal) {
    const tokenResponse = await fetch(ANTIGRAVITY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: ANTIGRAVITY_REDIRECT_URI,
            code_verifier: verifier,
        }),
        signal,
    });
    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => "");
        throw new Error(\`Antigravity token exchange failed (\${tokenResponse.status}): \${errorText}\`);
    }
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token || !tokenData.refresh_token) {
        throw new Error("Antigravity token exchange did not return access_token and refresh_token");
    }
    const [email, projectId] = await Promise.all([
        fetchAntigravityUserEmail(tokenData.access_token),
        discoverAntigravityProject(tokenData.access_token),
    ]);
    return {
        type: "oauth",
        access: tokenData.access_token,
        refresh: tokenData.refresh_token,
        expires: Date.now() + (tokenData.expires_in || 3600) * 1000 - 5 * 60 * 1000,
        projectId: projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
        ...(email ? { email } : {}),
    };
}

export async function refreshAntigravityToken(credential, signal) {
    const response = await fetch(ANTIGRAVITY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
            refresh_token: credential.refresh,
            grant_type: "refresh_token",
        }),
        signal,
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(\`Google Antigravity token refresh failed (\${response.status}): \${errorText}\`);
    }
    const data = await response.json();
    return {
        type: "oauth",
        access: data.access_token,
        refresh: data.refresh_token || credential.refresh,
        expires: Date.now() + (data.expires_in || 3600) * 1000 - 5 * 60 * 1000,
        projectId: credential.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
        ...(credential.email ? { email: credential.email } : {}),
    };
}

export const googleAntigravityOAuth = {
    name: "Google Antigravity (Cloud Code Assist)",
    loginLabel: "Sign in with Google Antigravity",
    isSubscription: true,
    async login(interaction) {
        const { verifier, challenge } = await generatePKCE();
        const state = randomBytes(16).toString("hex");
        const authParams = new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            response_type: "code",
            redirect_uri: ANTIGRAVITY_REDIRECT_URI,
            scope: ANTIGRAVITY_SCOPES.join(" "),
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
            access_type: "offline",
            prompt: "consent",
        });
        const authUrl = \`\${ANTIGRAVITY_AUTH_URL}?\${authParams.toString()}\`;
        const callback = await startOAuthCallbackServer({
            providerName: "Google Antigravity",
            host: "127.0.0.1",
            port: 51121,
            path: "/oauth-callback",
            state,
            complete: async (code) => code,
            signal: interaction.signal,
        }).catch(() => undefined);

        interaction.notify({
            type: "auth_url",
            url: authUrl,
            instructions: "Open the Google Antigravity sign-in page, sign in, and paste the redirect URL (http://localhost:51121/oauth-callback?code=...) below:",
        });

        try {
            const result = await waitForCallbackOrManualInput(interaction, callback, {
                message: "Paste the redirect URL (http://localhost:51121/oauth-callback?code=...) or authorization code here:",
                placeholder: ANTIGRAVITY_REDIRECT_URI,
            });
            let code;
            if (result.type === "callback") {
                code = result.value;
            } else {
                const parsed = parseAuthorizationInput(result.input);
                if (parsed.state && parsed.state !== state) {
                    throw new Error("OAuth state mismatch");
                }
                code = parsed.code;
            }
            if (!code) {
                throw new Error("Missing authorization code");
            }
            return await exchangeAntigravityCode(code, verifier, interaction.signal);
        } finally {
            callback?.close();
        }
    },
    refresh: (credential, signal) => refreshAntigravityToken(credential, signal),
    async toAuth(credential) {
        return {
            apiKey: JSON.stringify({
                __antigravity: true,
                token: credential.access,
                projectId: credential.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
                ...(credential.email ? { email: credential.email } : {}),
            }),
        };
    },
};
`;
wf(oauthFile, oauthCode, 'utf8');

// 2. Patch /node_modules/@earendil-works/pi-ai/dist/providers/google.js
const googleProviderFile = path.join(DSH_NODE_MODULES, '@earendil-works/pi-ai/dist/providers/google.js');
const googleProviderCode = `import { googleGenerativeAIApi } from "../api/google-generative-ai.lazy.js";
import { envApiKeyAuth } from "../auth/helpers.js";
import { googleAntigravityOAuth } from "../auth/oauth/google-antigravity.js";
import { createProvider } from "../models.js";
import { GOOGLE_MODELS } from "./google.models.js";
export function googleProvider() {
    return createProvider({
        id: "google",
        name: "AI Studio (Antigravity)",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        auth: {
            oauth: googleAntigravityOAuth,
            apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY"]),
        },
        models: Object.values(GOOGLE_MODELS),
        api: googleGenerativeAIApi(),
    });
}
`;
wf(googleProviderFile, googleProviderCode, 'utf8');

// 3. Patch /node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js
const googleApiFile = path.join(DSH_NODE_MODULES, '@earendil-works/pi-ai/dist/api/google-generative-ai.js');
const googleApiBackup = googleApiFile + '.before-antigravity';
const googleApiOriginal = fs.existsSync(googleApiBackup)
  ? fs.readFileSync(googleApiBackup, 'utf8')
  : fs.readFileSync(googleApiFile, 'utf8');
if (!fs.existsSync(googleApiBackup)) {
  wf(googleApiBackup, googleApiOriginal, 'utf8');
}

const ANTIGRAVITY_STREAM_HELPER = `
const ANTIGRAVITY_SYSTEM_INSTRUCTION =
    "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
    "You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
    "**Absolute paths only**" +
    "**Proactiveness**";

const DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const DAILY_ALT = "https://daily-cloudcode-pa.googleapis.com";
const PROD = "https://cloudcode-pa.googleapis.com";

// Every model id this provider exposes, mapped to the upstream ids to try in
// order. Upstream ids differ per account tier (a paid account has
// gemini-4-argon-high, a free-tier account only has gemini-4-argon-disabled
// plus the older gemini-3.8-flash-* set), so each row lists fallbacks.
const ANTIGRAVITY_MODEL_MAP = {
    "gemini-4-argon": [DAILY, DAILY_ALT, PROD].flatMap((base) => [
        [base, "gemini-4-argon-high"],
        [base, "gemini-4-argon-medium"],
        [base, "gemini-4-argon-low"],
        [base, "gemini-4-argon-disabled"], // free tier: present but flagged
        [base, "gemini-3.8-flash-tiered"],
    ]),
    "gemini-3.8-flash": [DAILY, DAILY_ALT, PROD].flatMap((base) => [
        [base, "gemini-3.8-flash-tiered"],
        [base, "gemini-3.8-flash-high"],
        [base, "gemini-3.8-flash-medium"],
        [base, "gemini-3.8-flash-low"],
        [base, "gemini-3-flash"],
        [base, "gemini-2.5-flash"],
    ]),
    "claude-sonnet-5-5": [DAILY, DAILY_ALT, PROD].flatMap((base) => [
        [base, "claude-sonnet-5-5-high"],
        [base, "claude-sonnet-5-5-medium"],
        [base, "claude-sonnet-5-5-low"],
        // free tier serves the older Sonnet instead
        [base, "claude-sonnet-4-6"],
    ]),
    "claude-opus-5-5": [DAILY, DAILY_ALT, PROD].flatMap((base) => [
        [base, "claude-opus-5-5-high"],
        [base, "claude-opus-5-5-medium"],
        [base, "claude-opus-5-5-low"],
        [base, "claude-opus-4-6-thinking"],
    ]),
};

function getAntigravityCandidates(modelId) {
    const mapped = ANTIGRAVITY_MODEL_MAP[modelId];
    if (mapped) return mapped;
    return [
        [DAILY, modelId],
        [DAILY_ALT, modelId],
        [PROD, modelId],
    ];
}

async function createAntigravityStream(model, normalizedContext, params, options, agAuth) {
    const currentTools = getCurrentTools(normalizedContext.messages);
    const generationConfig = {};
    if (params.config?.temperature !== undefined) {
        generationConfig.temperature = params.config.temperature;
    }
    if (params.config?.maxOutputTokens !== undefined) {
        generationConfig.maxOutputTokens = params.config.maxOutputTokens;
    }
    if (params.config?.thinkingConfig !== undefined) {
        const tc = { ...params.config.thinkingConfig };
        if (typeof tc.thinkingLevel === "string") {
            tc.thinkingLevel = tc.thinkingLevel.toUpperCase();
        }
        generationConfig.thinkingConfig = tc;
    }
    const existingSysText = params.config?.systemInstruction
        ? [{ text: sanitizeSurrogates(String(params.config.systemInstruction)) }]
        : [];
    const requestInner = {
        contents: params.contents,
        ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
        systemInstruction: {
            role: "user",
            parts: [
                { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
                { text: \`Please ignore following [ignore]\${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]\` },
                ...existingSysText,
            ],
        },
        ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
        ...(currentTools.length > 0 ? { tools: convertTools(currentTools, false, false) } : {}),
    };
    const candidates = getAntigravityCandidates(model.id);
    const headers = {
        Authorization: \`Bearer \${agAuth.token}\`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": "antigravity/1.15.8 darwin/arm64",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": JSON.stringify({
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
        }),
    };
    let lastErrorText = "";
    let lastStatus = 0;
    for (const [endpoint, candidateModel] of candidates) {
        if (options?.signal?.aborted) {
            throw new Error("Request was aborted");
        }
        const adjustedRequest = structuredClone(requestInner);
        if (
            candidateModel === "gemini-2.5-pro" ||
            candidateModel === "gemini-2.5-flash"
        ) {
            if (adjustedRequest.generationConfig?.thinkingConfig?.thinkingLevel) {
                delete adjustedRequest.generationConfig.thinkingConfig.thinkingLevel;
                adjustedRequest.generationConfig.thinkingConfig.thinkingBudget = 2048;
            }
        }
        const bodyObj = {
            project: agAuth.projectId || "rising-fact-p41fc",
            model: candidateModel,
            request: adjustedRequest,
            requestType: "agent",
            userAgent: "antigravity",
            requestId: \`agent-\${Date.now()}-\${Math.random().toString(36).slice(2, 11)}\`,
        };
        try {
            const response = await fetch(\`\${endpoint}/v1internal:streamGenerateContent?alt=sse\`, {
                method: "POST",
                headers,
                body: JSON.stringify(bodyObj),
                signal: options?.signal,
            });
            if (response.ok && response.body) {
                return (async function* () {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split("\\n");
                            buffer = lines.pop() || "";
                            for (const line of lines) {
                                if (!line.startsWith("data:")) continue;
                                const jsonStr = line.slice(5).trim();
                                if (!jsonStr) continue;
                                try {
                                    const parsed = JSON.parse(jsonStr);
                                    const chunk = parsed.response || parsed;
                                    if (chunk) yield chunk;
                                } catch {
                                    // ignore malformed SSE line
                                }
                            }
                        }
                    } finally {
                        await reader.cancel().catch(() => {});
                    }
                })();
            }
            lastStatus = response.status;
            lastErrorText = await response.text().catch(() => "");
        } catch (err) {
            lastErrorText = err instanceof Error ? err.message : String(err);
        }
    }
    throw new Error(\`Antigravity Cloud Code Assist error (\${lastStatus}): \${lastErrorText}\`);
}
`;

const anchorGoogleClient = `            const client = createClient(model, apiKey, options?.headers, options?.identity);
            let params = buildParams(model, normalizedContext, options);
            const nextParams = await options?.onPayload?.(params, model);
            if (nextParams !== undefined) {
                params = nextParams;
            }
            const googleStream = await retryGoogleRequest(() => client.models.generateContentStream(params), options);`;

const replacementGoogleClient = `            let params = buildParams(model, normalizedContext, options);
            const nextParams = await options?.onPayload?.(params, model);
            if (nextParams !== undefined) {
                params = nextParams;
            }
            let googleStream;
            if (typeof apiKey === "string" && apiKey.startsWith('{"__antigravity":true')) {
                const agAuth = JSON.parse(apiKey);
                googleStream = await createAntigravityStream(model, normalizedContext, params, options, agAuth);
            }
            else {
                const client = createClient(model, apiKey, options?.headers, options?.identity);
                googleStream = await retryGoogleRequest(() => client.models.generateContentStream(params), options);
            }`;

if (!googleApiOriginal.includes(anchorGoogleClient)) {
  throw new Error('Could not find anchorGoogleClient in google-generative-ai.js');
}
wf(
  googleApiFile,
  googleApiOriginal.replace(anchorGoogleClient, replacementGoogleClient) + '\n' + ANTIGRAVITY_STREAM_HELPER,
  'utf8'
);

// 4. Patch /node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
const targetFile = path.join(DSH_NODE_MODULES, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
const backupFile = targetFile + '.before-aistudio-session';

const original = fs.existsSync(backupFile)
  ? fs.readFileSync(backupFile, 'utf8')
  : fs.readFileSync(targetFile, 'utf8');

if (!fs.existsSync(backupFile)) {
  wf(backupFile, original, 'utf8');
}

const anchorCatalog = `function catalogProviders() {
\tproviderIndex ??= new Map(builtinProviders().filter(servesChat).map((provider) => [provider.id, provider]));
\treturn providerIndex;
}`;

const replacementCatalog = `const ALLOWED_GOOGLE_MODELS = new Set(["gemini-4-argon", "gemini-3.8-flash", "claude-sonnet-5-5", "claude-opus-5-5"]);
function catalogProviders() {
\tproviderIndex ??= new Map(builtinProviders().filter((provider) => provider.id === "google" && servesChat(provider)).map((provider) => [provider.id, provider]));
\treturn providerIndex;
}`;

const anchorCatalogModels = `function catalogModels(provider) {
\tif (!catalogProviders().has(provider)) return /* @__PURE__ */ new Map();
\tconst models = getBuiltinModels(provider);
\treturn new Map(models.map((model) => [model.id, model]));
}`;

const replacementCatalogModels = `function catalogModels(provider) {
\tif (!catalogProviders().has(provider)) return /* @__PURE__ */ new Map();
\tconst models = getBuiltinModels(provider).filter((model) => ALLOWED_GOOGLE_MODELS.has(model.id));
\treturn new Map(models.map((model) => [model.id, model]));
}`;

const HELPER_CODE = `
async function* aiStudioSessionStream(snapshot, model, context, streamOpts) {
	if (model.provider === "google" && ALLOWED_GOOGLE_MODELS.has(model.id)) {
		const requestedReasoning = streamOpts.reasoning;
		const fastReasoning = (requestedReasoning === "medium" || requestedReasoning === "high")
			? requestedReasoning
			: "low";
		const safeMaxTokens = Math.min(streamOpts.maxTokens ?? 65536, model.maxTokens ?? 65536, 65536);
		const optimizedOpts = {
			...streamOpts,
			reasoning: fastReasoning,
			temperature: void 0,
			maxTokens: safeMaxTokens,
			maxRetries: 3,
			maxRetryDelayMs: 1500
		};
		yield* snapshot.models.streamSimple(model, context, optimizedOpts);
		return;
	}
	yield* snapshot.models.streamSimple(model, context, streamOpts);
}
`;

const anchorStream = `const iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {`;
const replacementStream = `const iterator = toStreamChunks(aiStudioSessionStream(snapshot, model, context, {`;

for (const [name, anchor] of [
  ['catalogProviders', anchorCatalog],
  ['catalogModels', anchorCatalogModels],
  ['streamSimple', anchorStream],
]) {
  if (!original.includes(anchor)) {
    throw new Error(`Could not find ${name} anchor in dsh-llm-pi-ai`);
  }
}

const patched = original
  .replace(anchorCatalog, replacementCatalog)
  .replace(anchorCatalogModels, replacementCatalogModels)
  .replace(anchorStream, HELPER_CODE + '\n\t\t\t\t' + replacementStream);

wf(targetFile, patched, 'utf8');

// 5. Ensure /node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html has no floating Antigravity badge script
const frontendHtmlFile = path.join(DSH_NODE_MODULES, '@deepseek-ai/dsh-web-frontend/dist/index.html');
if (fs.existsSync(frontendHtmlFile)) {
  const html = fs.readFileSync(frontendHtmlFile, 'utf8');
  if (html.includes('/__antigravity_ui.js')) {
    const cleanedHtml = html.replace(/\s*<script src="\/__antigravity_ui\.js" defer><\/script>\n?/g, '\n');
    wf(frontendHtmlFile, cleanedHtml, 'utf8');
  }
}

console.log('[Antigravity Patch] Applied Google Antigravity OAuth + Cloud Code Assist SSE + 4-model catalog (gemini-4-argon, gemini-3.8-flash, claude-sonnet-5-5, claude-opus-5-5)');