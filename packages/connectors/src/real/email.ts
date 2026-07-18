import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';

import type { Connector, ConnectorExecutionResult } from '../connector.js';
import type { CredentialSource } from './types.js';

/**
 * Generic email connector over SMTP (send) and IMAP (fetch) — works with any
 * provider without OAuth. Credentials (host/port/user/pass per protocol) are
 * stored encrypted in `extra`.
 */

const sendParams = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  text: z.string().min(1),
});

const fetchParams = z.object({
  /** IMAP mailbox to read, default INBOX. */
  mailbox: z.string().optional(),
});

export interface EmailTransportFactory {
  /** Overridable in tests (nodemailer jsonTransport). */
  createSmtp(config: Record<string, string>): Transporter;
}

const defaultTransports: EmailTransportFactory = {
  createSmtp(config) {
    return nodemailer.createTransport({
      host: config['smtpHost'] ?? '',
      port: Number(config['smtpPort'] ?? 587),
      secure: config['smtpPort'] === '465',
      auth: { user: config['user'] ?? '', pass: config['password'] ?? '' },
    });
  },
};

export function createEmailConnector(
  credentials: CredentialSource,
  transports: EmailTransportFactory = defaultTransports,
): Connector {
  return {
    slug: 'email',
    displayName: 'Email (SMTP/IMAP)',
    auth: 'api_key',
    actions: [
      { name: 'send_email', description: 'Send a plain-text email', paramsSchema: sendParams },
      {
        name: 'fetch_email_with_attachment',
        description: 'Fetch the newest message with an attachment via IMAP',
        paramsSchema: fetchParams,
      },
    ],
    async execute(input): Promise<ConnectorExecutionResult> {
      const creds = await credentials(input);
      const config = creds.extra ?? {};

      if (input.action === 'send_email') {
        const params = sendParams.safeParse(input.params);
        if (!params.success) {
          return {
            ok: false,
            error: { code: 'CONNECTOR_ERROR', message: 'send_email requires to, subject, text' },
            retryable: false,
          };
        }
        try {
          const transporter = transports.createSmtp(config);
          const info = await transporter.sendMail({
            from: config['from'] ?? config['user'] ?? '',
            to: params.data.to,
            subject: params.data.subject,
            text: params.data.text,
          });
          return { ok: true, output: { delivered: true, messageId: info.messageId } };
        } catch (error) {
          return {
            ok: false,
            error: { code: 'CONNECTOR_ERROR', message: `SMTP: ${(error as Error).message}` },
            retryable: true,
          };
        }
      }

      if (input.action === 'fetch_email_with_attachment') {
        const mailbox = String(input.params['mailbox'] ?? 'INBOX');
        const client = new ImapFlow({
          host: config['imapHost'] ?? '',
          port: Number(config['imapPort'] ?? 993),
          secure: true,
          auth: { user: config['user'] ?? '', pass: config['password'] ?? '' },
          logger: false,
        });
        try {
          await client.connect();
          const lock = await client.getMailboxLock(mailbox);
          try {
            // Newest message first; stop at the first one with an attachment.
            for await (const message of client.fetch(
              { seq: '*:1' },
              { source: true },
              { uid: false },
            )) {
              if (!message.source) continue;
              const parsed = await simpleParser(message.source);
              const attachment = parsed.attachments[0];
              if (!attachment) continue;
              return {
                ok: true,
                output: {
                  found: true,
                  from: parsed.from?.text ?? '',
                  subject: parsed.subject ?? '',
                  receivedAt: parsed.date?.toISOString() ?? '',
                  attachmentName: attachment.filename ?? 'attachment',
                  attachmentText:
                    attachment.contentType === 'text/plain'
                      ? attachment.content.toString('utf8')
                      : (parsed.text ?? ''),
                },
              };
            }
            return { ok: true, output: { found: false } };
          } finally {
            lock.release();
          }
        } catch (error) {
          return {
            ok: false,
            error: { code: 'CONNECTOR_ERROR', message: `IMAP: ${(error as Error).message}` },
            retryable: true,
          };
        } finally {
          await client.logout().catch(() => {});
        }
      }

      return {
        ok: false,
        error: { code: 'CONNECTOR_ERROR', message: `Unknown action: ${input.action}` },
        retryable: false,
      };
    },
  };
}

/** Credential shape stored (encrypted) for an email account. */
export const emailCredentialsSchema = z.object({
  user: z.string().min(1),
  password: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.string().regex(/^\d+$/).default('587'),
  imapHost: z.string().optional(),
  imapPort: z.string().regex(/^\d+$/).optional(),
  from: z.string().optional(),
});
