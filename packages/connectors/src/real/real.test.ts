import assert from 'node:assert/strict';
import { test } from 'node:test';

import nodemailer from 'nodemailer';

import type { StoredCredentials } from '../crypto.js';
import { createEmailConnector, emailCredentialsSchema } from './email.js';
import { createGoogleConnector } from './google.js';
import { createHoldedConnector, holdedCredentialsSchema } from './holded.js';
import { createSlackConnector } from './slack.js';
import type { FetchLike } from './types.js';

const TENANT = {
  organizationId: 'org-1' as never,
  userId: 'user-1' as never,
  role: 'member' as const,
};

function credsOf(credentials: StoredCredentials) {
  return async () => credentials;
}

function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: unknown },
): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    const result = handler(url, init);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike;
  return { fetch: impl, calls };
}

test('slack connector posts with the bearer token and parses ok', async () => {
  const { fetch: stub, calls } = fakeFetch(() => ({ body: { ok: true, ts: '123.456' } }));
  const slack = createSlackConnector(
    credsOf({ kind: 'oauth_tokens', accessToken: 'xoxb-secret' }),
    stub,
  );
  const result = await slack.execute({
    tenant: TENANT,
    action: 'send_message',
    params: { channel: '#finance', text: 'hola' },
  });
  assert.deepEqual(result, {
    ok: true,
    output: { delivered: true, channel: '#finance', ts: '123.456' },
  });
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers['authorization'], 'Bearer xoxb-secret');
});

test('slack API-level errors surface with correct retryability', async () => {
  const { fetch: stub } = fakeFetch(() => ({ body: { ok: false, error: 'ratelimited' } }));
  const slack = createSlackConnector(credsOf({ kind: 'oauth_tokens', accessToken: 't' }), stub);
  const result = await slack.execute({
    tenant: TENANT,
    action: 'send_message',
    params: { channel: '#x', text: 'y' },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryable, true);
});

test('google connector fetches and decodes the newest matching email', async () => {
  const { fetch: stub } = fakeFetch((url) => {
    if (url.includes('/messages?')) return { body: { messages: [{ id: 'm1' }] } };
    return {
      body: {
        snippet: 'snippet',
        payload: {
          headers: [
            { name: 'From', value: 'billing@acme.example' },
            { name: 'Subject', value: 'Invoice 42' },
          ],
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: Buffer.from('INVOICE BODY').toString('base64url') },
            },
            { filename: 'invoice.pdf', mimeType: 'application/pdf' },
          ],
        },
      },
    };
  });
  const google = createGoogleConnector(
    credsOf({ kind: 'oauth_tokens', accessToken: 'ya29' }),
    stub,
  );
  const result = await google.execute({
    tenant: TENANT,
    action: 'fetch_email_with_attachment',
    params: {},
  });
  assert.ok(result.ok);
  const output = result.output as Record<string, unknown>;
  assert.equal(output['subject'], 'Invoice 42');
  assert.equal(output['attachmentName'], 'invoice.pdf');
  assert.equal(output['attachmentText'], 'INVOICE BODY');
});

test('email connector sends through SMTP (json transport)', async () => {
  const email = createEmailConnector(
    credsOf({
      kind: 'api_key',
      extra: { user: 'bot@corp.example', password: 'pw', smtpHost: 'smtp.corp.example' },
    }),
    { createSmtp: () => nodemailer.createTransport({ jsonTransport: true }) },
  );
  const result = await email.execute({
    tenant: TENANT,
    action: 'send_email',
    params: { to: 'dest@corp.example', subject: 'Hola', text: 'Cuerpo' },
  });
  assert.ok(result.ok);
  assert.ok((result.output as { messageId: string }).messageId.length > 0);
});

test('holded connector registers a purchase entry with the api key header', async () => {
  const { fetch: stub, calls } = fakeFetch(() => ({ body: { status: 1, id: 'doc-9' } }));
  const holded = createHoldedConnector(
    credsOf({ kind: 'api_key', apiKey: 'holded-key-123' }),
    stub,
  );
  const result = await holded.execute({
    tenant: TENANT,
    action: 'create_entry',
    params: { vendor: 'ACME', totalAmount: 342.5, date: '2026-06-28' },
  });
  assert.deepEqual(result, { ok: true, output: { entryId: 'doc-9', registered: true } });
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers['key'], 'holded-key-123');
  assert.match(calls[0]?.url ?? '', /documents\/purchase$/);
});

test('credential schemas validate the connect payloads', () => {
  assert.ok(
    emailCredentialsSchema.safeParse({
      user: 'a@b.c',
      password: 'x',
      smtpHost: 'smtp.b.c',
    }).success,
  );
  assert.ok(!holdedCredentialsSchema.safeParse({ apiKey: 'short' }).success);
  assert.ok(holdedCredentialsSchema.safeParse({ apiKey: 'long-enough-key' }).success);
});
