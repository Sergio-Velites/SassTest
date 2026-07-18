import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  CheckoutSession,
  CheckoutSessionInput,
  PaymentGateway,
  PaymentWebhookEvent,
  PortalSessionInput,
} from './gateway.js';

/**
 * Stripe over plain fetch (no SDK — same policy as ai-gateway providers).
 * Endpoints are form-encoded per https://docs.stripe.com/api. Built for test
 * mode; not verified against the live API until the user provides keys.
 */

const STRIPE_API = 'https://api.stripe.com/v1';
const DEFAULT_TOLERANCE_SECONDS = 300;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StripeGatewayOptions {
  secretKey: string;
  webhookSecret: string;
  fetchImpl?: FetchLike;
  /** Injectable clock for signature-tolerance tests. */
  now?: () => number;
}

function form(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

export class StripePaymentGateway implements PaymentGateway {
  readonly kind = 'stripe' as const;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: StripeGatewayOptions) {
    this.secretKey = options.secretKey;
    this.webhookSecret = options.webhookSecret;
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.now = options.now ?? (() => Date.now());
  }

  private async post(path: string, data: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form(data),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = body['error'] as { message?: string } | undefined;
      throw new Error(`Stripe ${path} failed (${response.status}): ${error?.message ?? 'unknown'}`);
    }
    return body;
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const body = await this.post('/checkout/sessions', {
      mode: 'subscription',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(input.priceCents),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': `FlowHub AI — plan ${input.planSlug}`,
      'metadata[organizationId]': input.organizationId,
      'metadata[planSlug]': input.planSlug,
      'subscription_data[metadata][organizationId]': input.organizationId,
      'subscription_data[metadata][planSlug]': input.planSlug,
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    });
    return { url: String(body['url']), sessionId: String(body['id']) };
  }

  async createPortalSession(input: PortalSessionInput): Promise<{ url: string }> {
    const body = await this.post('/billing_portal/sessions', {
      customer: input.externalCustomerRef,
      return_url: input.returnUrl,
    });
    return { url: String(body['url']) };
  }

  verifyWebhook(rawBody: string, signatureHeader: string): PaymentWebhookEvent {
    const event = verifyStripeSignature({
      payload: rawBody,
      header: signatureHeader,
      secret: this.webhookSecret,
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      nowMs: this.now(),
    });
    return event;
  }
}

/**
 * Stripe webhook signature scheme: header `t=<unix>,v1=<hmac>` where hmac =
 * HMAC-SHA256(secret, `${t}.${payload}`). Pure function — fully testable
 * without any Stripe account.
 */
export function verifyStripeSignature(input: {
  payload: string;
  header: string;
  secret: string;
  toleranceSeconds: number;
  nowMs: number;
}): PaymentWebhookEvent {
  const parts = new Map<string, string[]>();
  for (const piece of input.header.split(',')) {
    const [key, value] = piece.split('=', 2);
    if (!key || value === undefined) continue;
    const list = parts.get(key.trim()) ?? [];
    list.push(value.trim());
    parts.set(key.trim(), list);
  }
  const timestamp = Number(parts.get('t')?.[0]);
  const signatures = parts.get('v1') ?? [];
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new Error('Malformed Stripe-Signature header');
  }
  const ageSeconds = Math.abs(input.nowMs / 1000 - timestamp);
  if (ageSeconds > input.toleranceSeconds) {
    throw new Error('Webhook timestamp outside tolerance');
  }
  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const valid = signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate);
    return (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });
  if (!valid) throw new Error('Webhook signature mismatch');

  const parsed = JSON.parse(input.payload) as {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  if (!parsed.id || !parsed.type) throw new Error('Webhook payload missing id/type');
  return { id: parsed.id, type: parsed.type, data: parsed.data?.object ?? {} };
}

/** Test helper: builds a valid Stripe-Signature header for a payload. */
export function signStripePayload(
  payload: string,
  secret: string,
  timestampSeconds: number,
): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}
