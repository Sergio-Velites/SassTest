import { z } from 'zod';

import type { Connector, ConnectorExecutionResult } from '../connector.js';
import type { CredentialSource, FetchLike } from './types.js';

const sendMessageParams = z.object({ channel: z.string().min(1), text: z.string().min(1) });

/** Real Slack connector (OAuth bot token). Activated via SLACK_CLIENT_ID/SECRET. */
export function createSlackConnector(
  credentials: CredentialSource,
  fetchImpl: FetchLike = fetch,
): Connector {
  return {
    slug: 'slack',
    displayName: 'Slack',
    auth: 'oauth2',
    actions: [
      {
        name: 'send_message',
        description: 'Send a message to a channel',
        paramsSchema: sendMessageParams,
      },
    ],
    async execute(input): Promise<ConnectorExecutionResult> {
      if (input.action !== 'send_message') {
        return {
          ok: false,
          error: { code: 'CONNECTOR_ERROR', message: `Unknown action: ${input.action}` },
          retryable: false,
        };
      }
      const params = sendMessageParams.safeParse(input.params);
      if (!params.success) {
        return {
          ok: false,
          error: { code: 'CONNECTOR_ERROR', message: 'send_message requires channel and text' },
          retryable: false,
        };
      }
      const creds = await credentials(input);
      const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${creds.accessToken ?? ''}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel: params.data.channel, text: params.data.text }),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: { code: 'CONNECTOR_ERROR', message: `Slack HTTP ${response.status}` },
          retryable: response.status >= 500 || response.status === 429,
        };
      }
      const body = (await response.json()) as { ok: boolean; error?: string; ts?: string };
      if (!body.ok) {
        return {
          ok: false,
          error: { code: 'CONNECTOR_ERROR', message: `Slack error: ${body.error ?? 'unknown'}` },
          retryable: body.error === 'ratelimited',
        };
      }
      return { ok: true, output: { delivered: true, channel: params.data.channel, ts: body.ts } };
    },
  };
}
