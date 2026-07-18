import { createHash, randomBytes } from 'node:crypto';

/**
 * Minimal OAuth2 authorization-code + PKCE client over fetch (no SDKs).
 * Provider quirks live in the per-connector config, not here.
 */

export interface OAuthProviderConfig {
  slug: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query params for the authorization redirect (e.g. Google offline access). */
  extraAuthParams?: Record<string, string>;
  /** Some providers (Slack) nest tokens; map the raw token response here. */
  parseTokenResponse?: (raw: Record<string, unknown>) => TokenSet;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch millis; undefined = non-expiring token. */
  expiresAt?: number;
  extra?: Record<string, string>;
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizationUrl(input: {
  provider: OAuthProviderConfig;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.provider.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.provider.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(input.provider.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function defaultParse(raw: Record<string, unknown>): TokenSet {
  const accessToken = raw['access_token'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Token response missing access_token');
  }
  const expiresIn = typeof raw['expires_in'] === 'number' ? raw['expires_in'] : undefined;
  return {
    accessToken,
    ...(typeof raw['refresh_token'] === 'string' ? { refreshToken: raw['refresh_token'] } : {}),
    ...(expiresIn !== undefined ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
  };
}

export async function exchangeAuthorizationCode(input: {
  provider: OAuthProviderConfig;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.codeVerifier,
  });
  const response = await fetch(input.provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: HTTP ${response.status}`);
  }
  const raw = (await response.json()) as Record<string, unknown>;
  if (raw['error']) {
    throw new Error(`Token exchange failed: ${String(raw['error'])}`);
  }
  return (input.provider.parseTokenResponse ?? defaultParse)(raw);
}

export async function refreshAccessToken(input: {
  provider: OAuthProviderConfig;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  const response = await fetch(input.provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed: HTTP ${response.status}`);
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const parsed = (input.provider.parseTokenResponse ?? defaultParse)(raw);
  // Providers often omit the refresh token on refresh — keep the old one.
  return { ...parsed, refreshToken: parsed.refreshToken ?? input.refreshToken };
}

/** OAuth configs for the real connectors (implementations arrive with them). */
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  slack: {
    slug: 'slack',
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read'],
    parseTokenResponse: (raw) => {
      if (raw['ok'] !== true) throw new Error(`Slack OAuth error: ${String(raw['error'])}`);
      const accessToken = String(raw['access_token'] ?? '');
      if (!accessToken) throw new Error('Slack response missing access_token');
      const team = raw['team'] as { id?: string; name?: string } | undefined;
      return {
        accessToken,
        extra: {
          ...(team?.id ? { teamId: team.id } : {}),
          ...(team?.name ? { teamName: team.name } : {}),
        },
      };
    },
  },
  google: {
    slug: 'google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
};
