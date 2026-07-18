import { z } from 'zod';

import type { Connector, ConnectorExecutionResult } from '../connector.js';
import type { CredentialSource, FetchLike } from './types.js';

/**
 * Holded connector (API key). Closes the invoice-intake vertical: registers
 * purchase documents in the customer's accounting. Request shapes follow
 * https://developers.holded.com — not verified live until a key exists.
 */

const createEntryParams = z.object({
  /** Vendor/contact name shown on the document. */
  vendor: z.string().min(1).optional(),
  totalAmount: z.coerce.number().optional(),
  date: z.string().optional(),
  /** Free-form notes; the demo passes the extracted invoice payload. */
  notes: z.string().optional(),
});

export function createHoldedConnector(
  credentials: CredentialSource,
  fetchImpl: FetchLike = fetch,
): Connector {
  return {
    slug: 'holded',
    displayName: 'Holded (contabilidad)',
    auth: 'api_key',
    actions: [
      {
        name: 'create_entry',
        description: 'Register a purchase document in Holded',
        paramsSchema: createEntryParams,
      },
    ],
    async execute(input): Promise<ConnectorExecutionResult> {
      if (input.action !== 'create_entry') {
        return {
          ok: false,
          error: { code: 'CONNECTOR_ERROR', message: `Unknown action: ${input.action}` },
          retryable: false,
        };
      }
      const params = createEntryParams.parse(input.params ?? {});
      const creds = await credentials(input);
      const response = await fetchImpl(
        'https://api.holded.com/api/invoicing/v1/documents/purchase',
        {
          method: 'POST',
          headers: {
            key: creds.apiKey ?? '',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            contactName: params.vendor ?? 'Unknown vendor',
            date: params.date ? Math.floor(new Date(params.date).getTime() / 1000) : undefined,
            notes: params.notes,
            items: [
              {
                name: params.notes ?? 'FlowHub registered document',
                units: 1,
                subtotal: params.totalAmount ?? 0,
              },
            ],
          }),
        },
      );
      if (!response.ok) {
        return {
          ok: false,
          error: { code: 'CONNECTOR_ERROR', message: `Holded HTTP ${response.status}` },
          retryable: response.status >= 500 || response.status === 429,
        };
      }
      const body = (await response.json()) as { status?: number; id?: string };
      return { ok: true, output: { entryId: body.id ?? '', registered: true } };
    },
  };
}

/** Credential shape stored (encrypted) for a Holded account. */
export const holdedCredentialsSchema = z.object({ apiKey: z.string().min(8) });
