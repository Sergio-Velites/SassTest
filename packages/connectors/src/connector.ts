import type { TenantContext } from '@flowhub/shared';
import type { z } from 'zod';

export interface ConnectorActionDefinition {
  /** e.g. 'send_message', 'list_emails' */
  name: string;
  description: string;
  /** Zod schema for the action's config/params — validated at build time in the editor. */
  paramsSchema: z.ZodTypeAny;
}

export interface ConnectorExecutionInput {
  tenant: TenantContext;
  action: string;
  params: Record<string, unknown>;
  /**
   * Present when the connector requires an account. Credentials are resolved
   * by the secrets layer at runtime — handlers never see raw tokens in logs.
   */
  connectorAccountId?: string;
}

export type ConnectorExecutionResult =
  | { ok: true; output: unknown }
  | { ok: false; error: { code: string; message: string }; retryable: boolean };

/**
 * Contract every connector implements. `auth: 'none'` for mock/generic
 * connectors; 'api_key' and 'oauth2' arrive post-MVP (interface is final,
 * implementations are not).
 */
export interface Connector {
  /** Stable slug, e.g. 'slack-mock'. Referenced from workflow node configs. */
  readonly slug: string;
  readonly displayName: string;
  readonly auth: 'none' | 'api_key' | 'oauth2';
  readonly actions: ConnectorActionDefinition[];
  execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult>;
}
