import { z } from 'zod';

import type { Connector, ConnectorExecutionInput, ConnectorExecutionResult } from './connector.js';

/**
 * Deterministic mock connectors for the MVP. No network, no credentials.
 * Each returns realistic-shaped data so workflows and the UI behave like
 * they will with real connectors.
 */

function ok(output: unknown): ConnectorExecutionResult {
  return { ok: true, output };
}

function unknownAction(input: ConnectorExecutionInput): ConnectorExecutionResult {
  return {
    ok: false,
    error: { code: 'CONNECTOR_ERROR', message: `Unknown action: ${input.action}` },
    retryable: false,
  };
}

export const gmailMock: Connector = {
  slug: 'gmail-mock',
  displayName: 'Gmail (mock)',
  auth: 'none',
  actions: [
    {
      name: 'fetch_email_with_attachment',
      description: 'Returns a fake email carrying a PDF invoice as text',
      paramsSchema: z.object({}).passthrough(),
    },
  ],
  async execute(input) {
    if (input.action !== 'fetch_email_with_attachment') return unknownAction(input);
    return ok({
      from: 'billing@acme-supplies.example',
      subject: 'Invoice ACME-2026-0042',
      receivedAt: new Date().toISOString(),
      attachmentName: 'invoice-acme-2026-0042.pdf',
      attachmentText:
        'INVOICE ACME-2026-0042\nVendor: ACME Supplies S.L.\nDate: 2026-06-28\nSubtotal: 283.06 EUR\nVAT (21%): 59.44 EUR\nTotal: 342.50 EUR',
    });
  },
};

export const slackMock: Connector = {
  slug: 'slack-mock',
  displayName: 'Slack (mock)',
  auth: 'none',
  actions: [
    {
      name: 'send_message',
      description: 'Pretends to send a Slack message',
      paramsSchema: z.object({ channel: z.string(), text: z.string() }),
    },
  ],
  async execute(input) {
    if (input.action !== 'send_message') return unknownAction(input);
    const params = z.object({ channel: z.string(), text: z.string() }).safeParse(input.params);
    if (!params.success) {
      return {
        ok: false,
        error: { code: 'CONNECTOR_ERROR', message: 'send_message requires channel and text' },
        retryable: false,
      };
    }
    return ok({ delivered: true, channel: params.data.channel, text: params.data.text });
  },
};

export const driveMock: Connector = {
  slug: 'drive-mock',
  displayName: 'Google Drive (mock)',
  auth: 'none',
  actions: [
    {
      name: 'save_file',
      description: 'Pretends to store a file and returns a fake file id',
      paramsSchema: z.object({ name: z.string(), content: z.string().optional() }),
    },
  ],
  async execute(input) {
    if (input.action !== 'save_file') return unknownAction(input);
    const name = String((input.params['name'] as string | undefined) ?? 'file.txt');
    return ok({ fileId: `drive-mock-${Buffer.from(name).toString('hex').slice(0, 12)}`, name });
  },
};

export const accountingMock: Connector = {
  slug: 'accounting-mock',
  displayName: 'Accounting (mock)',
  auth: 'none',
  actions: [
    {
      name: 'create_entry',
      description: 'Registers an accounting entry and returns its id',
      paramsSchema: z.object({}).passthrough(),
    },
  ],
  async execute(input) {
    if (input.action !== 'create_entry') return unknownAction(input);
    return ok({ entryId: `entry-${Date.now()}`, registered: true, source: input.params });
  },
};

/**
 * Generic HTTP connector. In the MVP it is a MOCK ECHO — it performs NO real
 * network calls. Real outbound HTTP requires the per-organization host
 * allowlist + SSRF guards (SECURITY_MODEL.md §8) before being enabled.
 */
export const httpGenericMock: Connector = {
  slug: 'http-generic',
  displayName: 'HTTP request (mock)',
  auth: 'none',
  actions: [
    {
      name: 'request',
      description: 'Echoes the request it would have performed (no real network in MVP)',
      paramsSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
        url: z.string().url(),
        body: z.unknown().optional(),
      }),
    },
  ],
  async execute(input) {
    if (input.action !== 'request') return unknownAction(input);
    return ok({ mock: true, wouldHaveSent: input.params, status: 200 });
  },
};

/** Inbound webhook connector — defines the trigger contract (post-MVP wiring). */
export const webhookInbound: Connector = {
  slug: 'webhook-inbound',
  displayName: 'Inbound webhook',
  auth: 'none',
  actions: [
    {
      name: 'receive',
      description: 'Passes through the payload received by the webhook trigger',
      paramsSchema: z.object({ payload: z.unknown() }),
    },
  ],
  async execute(input) {
    if (input.action !== 'receive') return unknownAction(input);
    return ok({ payload: input.params['payload'] ?? null });
  },
};

/** Registry with every built-in mock connector. */
export function createMockConnectorRegistry(): Map<string, Connector> {
  const connectors = [
    gmailMock,
    slackMock,
    driveMock,
    accountingMock,
    httpGenericMock,
    webhookInbound,
  ];
  return new Map(connectors.map((c) => [c.slug, c]));
}
