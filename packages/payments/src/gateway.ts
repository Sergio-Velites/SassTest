/**
 * PaymentGateway port — the only surface the API talks to for billing.
 * Implementations: StripePaymentGateway (test mode) and MockPaymentGateway
 * (local/dev/tests without keys). Business logic never imports Stripe types.
 */

export interface CheckoutSessionInput {
  organizationId: string;
  planSlug: string;
  priceCents: number;
  currency: string;
  /** Where the provider redirects after payment. */
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export interface CheckoutSession {
  /** Hosted page the browser must be redirected to. */
  url: string;
  sessionId: string;
}

export interface PortalSessionInput {
  /** Provider-side customer reference (subscriptions.external_ref). */
  externalCustomerRef: string;
  returnUrl: string;
}

/** Normalized webhook event — the subset of the provider event we act on. */
export interface PaymentWebhookEvent {
  id: string;
  type: string;
  /** Raw event data object (provider-shaped, validated by the consumer). */
  data: Record<string, unknown>;
}

export interface PaymentGateway {
  /** 'mock' enables the synchronous local upgrade path in the API. */
  readonly kind: 'mock' | 'stripe';
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
  /**
   * Verifies the webhook signature over the RAW request body and returns the
   * parsed event. Throws on invalid/missing/expired signatures.
   */
  verifyWebhook(rawBody: string, signatureHeader: string): PaymentWebhookEvent;
}
