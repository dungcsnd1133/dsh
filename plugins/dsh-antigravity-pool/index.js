export const name = 'dsh-antigravity-pool';

/**
 * Antigravity OAuth credentials come from the environment only.
 * Copy .env.example to .env (or set the variables in your process
 * manager) before enabling the pool. This repository never stores
 * real client credentials.
 */
export function readAntigravityEnv() {
  return {
    clientId: process.env.ANTIGRAVITY_CLIENT_ID ?? '',
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET ?? '',
  };
}

export function isConfigured() {
  const { clientId, clientSecret } = readAntigravityEnv();
  return clientId.length > 0 && clientSecret.length > 0;
}

export function apply() {}
