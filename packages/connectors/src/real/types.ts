import type { StoredCredentials } from '../crypto.js';
import type { ConnectorExecutionInput } from '../connector.js';

/**
 * How real connectors obtain credentials at execution time. The worker wires
 * this to the encrypted secrets store (resolving input.connectorAccountId,
 * tenant-scoped, refreshing OAuth tokens when needed); tests provide stubs.
 * Connectors NEVER receive raw tokens through configs (SECURITY_MODEL.md §8).
 */
export type CredentialSource = (input: ConnectorExecutionInput) => Promise<StoredCredentials>;

/** Injectable fetch so connector logic is testable without network access. */
export type FetchLike = typeof globalThis.fetch;

import type { Connector } from '../connector.js';

/**
 * Wraps a connector so credential-resolution failures (missing account,
 * cross-tenant, revoked) surface as typed CONNECTOR_ERROR results instead of
 * exceptions — the executor then fails the node without retrying.
 */
export function withConnectorErrorBoundary(connector: Connector): Connector {
  return {
    ...connector,
    async execute(input) {
      try {
        return await connector.execute(input);
      } catch (error) {
        return {
          ok: false,
          error: { code: 'CONNECTOR_ERROR', message: (error as Error).message },
          retryable: false,
        };
      }
    },
  };
}
