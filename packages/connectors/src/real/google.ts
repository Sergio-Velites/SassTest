import { z } from 'zod';

import type { Connector, ConnectorExecutionResult } from '../connector.js';
import type { CredentialSource, FetchLike } from './types.js';

/**
 * Real Google connector: Gmail (readonly) + Drive (file upload).
 * Scopes: gmail.readonly, drive.file. Not verified against live APIs until
 * the OAuth app exists — the request shapes follow the public REST docs.
 */
export function createGoogleConnector(
  credentials: CredentialSource,
  fetchImpl: FetchLike = fetch,
): Connector {
  return {
    slug: 'google',
    displayName: 'Google (Gmail/Drive)',
    auth: 'oauth2',
    actions: [
      {
        name: 'fetch_email_with_attachment',
        description: 'Fetch the most recent email matching a query (default: with attachment)',
        paramsSchema: z.object({ query: z.string().optional() }),
      },
      {
        name: 'save_file',
        description: 'Upload a text file to Drive',
        paramsSchema: z.object({ name: z.string().min(1), content: z.string() }),
      },
    ],
    async execute(input): Promise<ConnectorExecutionResult> {
      const creds = await credentials(input);
      const authHeader = { authorization: `Bearer ${creds.accessToken ?? ''}` };

      if (input.action === 'fetch_email_with_attachment') {
        const query = String(input.params['query'] ?? 'has:attachment');
        const listResponse = await fetchImpl(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent(query)}`,
          { headers: authHeader },
        );
        if (!listResponse.ok) {
          return gmailError(listResponse.status, 'list messages');
        }
        const list = (await listResponse.json()) as { messages?: Array<{ id: string }> };
        const messageId = list.messages?.[0]?.id;
        if (!messageId) {
          return { ok: true, output: { found: false } };
        }
        const messageResponse = await fetchImpl(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
          { headers: authHeader },
        );
        if (!messageResponse.ok) {
          return gmailError(messageResponse.status, 'get message');
        }
        const message = (await messageResponse.json()) as {
          snippet?: string;
          payload?: {
            headers?: Array<{ name: string; value: string }>;
            parts?: Array<{ mimeType?: string; filename?: string; body?: { data?: string } }>;
          };
        };
        const headers = new Map(
          (message.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
        );
        const textPart = (message.payload?.parts ?? []).find(
          (p) => p.mimeType === 'text/plain' && p.body?.data,
        );
        const attachment = (message.payload?.parts ?? []).find((p) => p.filename);
        return {
          ok: true,
          output: {
            found: true,
            from: headers.get('from') ?? '',
            subject: headers.get('subject') ?? '',
            receivedAt: headers.get('date') ?? '',
            attachmentName: attachment?.filename ?? null,
            attachmentText: textPart?.body?.data
              ? Buffer.from(textPart.body.data, 'base64url').toString('utf8')
              : (message.snippet ?? ''),
          },
        };
      }

      if (input.action === 'save_file') {
        const name = String(input.params['name'] ?? 'file.txt');
        const content = String(input.params['content'] ?? '');
        const boundary = 'flowhub-multipart-boundary';
        const body = [
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify({ name }),
          `--${boundary}`,
          'Content-Type: text/plain',
          '',
          content,
          `--${boundary}--`,
        ].join('\r\n');
        const response = await fetchImpl(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: {
              ...authHeader,
              'content-type': `multipart/related; boundary=${boundary}`,
            },
            body,
          },
        );
        if (!response.ok) {
          return {
            ok: false,
            error: { code: 'CONNECTOR_ERROR', message: `Drive HTTP ${response.status}` },
            retryable: response.status >= 500 || response.status === 429,
          };
        }
        const file = (await response.json()) as { id?: string };
        return { ok: true, output: { fileId: file.id ?? '', name } };
      }

      return {
        ok: false,
        error: { code: 'CONNECTOR_ERROR', message: `Unknown action: ${input.action}` },
        retryable: false,
      };
    },
  };
}

function gmailError(status: number, step: string): ConnectorExecutionResult {
  return {
    ok: false,
    error: { code: 'CONNECTOR_ERROR', message: `Gmail HTTP ${status} (${step})` },
    retryable: status >= 500 || status === 429,
  };
}
