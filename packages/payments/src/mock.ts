import type {
  CheckoutSession,
  CheckoutSessionInput,
  PaymentGateway,
  PaymentWebhookEvent,
  PortalSessionInput,
} from './gateway.js';

/**
 * Deterministic gateway for local development and tests — no keys, no
 * network. Checkout "succeeds" instantly: the API applies the plan change
 * synchronously when gateway.kind === 'mock' (documented in the billing
 * routes), so the full upgrade flow works offline.
 */
export class MockPaymentGateway implements PaymentGateway {
  readonly kind = 'mock' as const;
  readonly checkoutSessions: CheckoutSessionInput[] = [];
  private counter = 0;

  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    this.checkoutSessions.push(input);
    this.counter += 1;
    const sessionId = `mock_cs_${this.counter}`;
    const separator = input.successUrl.includes('?') ? '&' : '?';
    return Promise.resolve({
      url: `${input.successUrl}${separator}mock_checkout=${encodeURIComponent(input.planSlug)}`,
      sessionId,
    });
  }

  createPortalSession(input: PortalSessionInput): Promise<{ url: string }> {
    return Promise.resolve({ url: input.returnUrl });
  }

  verifyWebhook(rawBody: string, signatureHeader: string): PaymentWebhookEvent {
    if (signatureHeader !== 'mock-signature') throw new Error('Invalid mock signature');
    const parsed = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    return {
      id: parsed.id ?? 'mock_evt',
      type: parsed.type ?? 'unknown',
      data: parsed.data?.object ?? {},
    };
  }
}
