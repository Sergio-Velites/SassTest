import type { Env } from '@flowhub/config';
import {
  createEmailConnector,
  createGoogleConnector,
  createHoldedConnector,
  createMockConnectorRegistry,
  createSlackConnector,
  DbSecretsStore,
  OAUTH_PROVIDERS,
  refreshAccessToken,
  SecretCipher,
  withConnectorErrorBoundary,
  type Connector,
  type ConnectorExecutionInput,
  type CredentialSource,
  type StoredCredentials,
} from '@flowhub/connectors';
import { createSecretRowStore, schema, type Db } from '@flowhub/database';
import type { Logger } from '@flowhub/observability';
import { and, eq } from 'drizzle-orm';

const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Resolves a connector account's credentials at execution time:
 * tenant-scoped lookup → decrypt → transparent OAuth refresh (persisting the
 * rotated tokens). Real connectors never see how storage works.
 */
export function createCredentialSource(input: {
  db: Db;
  secrets: DbSecretsStore;
  env: Env;
  logger: Logger;
}): CredentialSource {
  const { db, secrets, env, logger } = input;

  return async (execution: ConnectorExecutionInput): Promise<StoredCredentials> => {
    if (!execution.connectorAccountId) {
      throw new Error('This connector requires a connected account (connectorAccountId)');
    }
    const [account] = await db
      .select()
      .from(schema.connectorAccounts)
      .where(
        and(
          eq(schema.connectorAccounts.id, execution.connectorAccountId),
          eq(schema.connectorAccounts.organizationId, execution.tenant.organizationId),
          eq(schema.connectorAccounts.status, 'active'),
        ),
      );
    if (!account) throw new Error('Connector account not found or revoked');

    const [metadata] = await db
      .select()
      .from(schema.connectorSecretsMetadata)
      .where(
        and(
          eq(schema.connectorSecretsMetadata.connectorAccountId, account.id),
          eq(schema.connectorSecretsMetadata.organizationId, execution.tenant.organizationId),
        ),
      );
    if (!metadata) throw new Error('Connector account has no stored credentials');

    const credentials = await secrets.retrieve(execution.tenant.organizationId, metadata.secretRef);
    if (!credentials) throw new Error('Stored credentials could not be read');

    // Transparent OAuth refresh shortly before expiry.
    const needsRefresh =
      credentials.kind === 'oauth_tokens' &&
      credentials.refreshToken !== undefined &&
      credentials.expiresAt !== undefined &&
      credentials.expiresAt < Date.now() + TOKEN_REFRESH_MARGIN_MS;
    if (!needsRefresh) return credentials;

    const provider = OAUTH_PROVIDERS[account.connectorSlug];
    const clientId = account.connectorSlug === 'slack' ? env.SLACK_CLIENT_ID : env.GOOGLE_CLIENT_ID;
    const clientSecret =
      account.connectorSlug === 'slack' ? env.SLACK_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET;
    if (!provider || !clientId || !clientSecret) return credentials; // cannot refresh — use as-is

    const refreshed = await refreshAccessToken({
      provider,
      clientId,
      clientSecret,
      refreshToken: credentials.refreshToken as string,
    });
    const updated: StoredCredentials = {
      ...credentials,
      accessToken: refreshed.accessToken,
      ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
      ...(refreshed.expiresAt ? { expiresAt: refreshed.expiresAt } : {}),
    };
    await secrets.update(execution.tenant.organizationId, metadata.secretRef, updated);
    logger.info('oauth token refreshed', {
      organizationId: execution.tenant.organizationId,
      connectorSlug: account.connectorSlug,
    });
    return updated;
  };
}

/**
 * Connector registry for the executor: mocks always; real connectors join
 * when CONNECTOR_SECRETS_KEY is configured. Workflow nodes select by slug
 * (`slack-mock` vs `slack`), so both worlds coexist.
 */
export function createWorkerConnectorRegistry(input: {
  db: Db;
  env: Env;
  logger: Logger;
}): Map<string, Connector> {
  const registry = createMockConnectorRegistry();
  const { env, db, logger } = input;
  if (!env.CONNECTOR_SECRETS_KEY) {
    logger.warn('CONNECTOR_SECRETS_KEY not set — real connectors disabled, mocks only');
    return registry;
  }
  const secrets = new DbSecretsStore(
    createSecretRowStore(db),
    new SecretCipher(env.CONNECTOR_SECRETS_KEY),
  );
  const credentials = createCredentialSource({ db, secrets, env, logger });
  for (const connector of [
    createSlackConnector(credentials),
    createGoogleConnector(credentials),
    createEmailConnector(credentials),
    createHoldedConnector(credentials),
  ]) {
    registry.set(connector.slug, withConnectorErrorBoundary(connector));
  }
  return registry;
}
