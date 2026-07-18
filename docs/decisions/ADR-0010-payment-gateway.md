# ADR-0010: Billing — Stripe test mode tras interfaz PaymentGateway

- **Estado:** accepted
- **Fecha:** 2026-07-18

## Contexto

El Ciclo 13 introduce cobro de suscripciones (Free → Business) y enforcement de límites
de plan. Requisitos: funcionar en local sin cuenta de Stripe, mantener la lógica de negocio
desacoplada del proveedor (misma política que JobQueue/ADR-0005 y AI providers/ADR-0007) y
no exigir claves para el desarrollo ni para CI.

## Decisión

1. **Interfaz `PaymentGateway`** en `packages/payments`: `createCheckoutSession`,
   `createPortalSession`, `verifyWebhook`. La API solo conoce esta interfaz.
2. **`StripePaymentGateway` sobre fetch** (form-encoded, sin SDK — coherente con la política
   cero-deps de ai-gateway). Checkout Sessions con `price_data` inline (sin catálogo de
   Prices en Stripe: los planes viven en la tabla `plans`) y metadata
   `organizationId`/`planSlug` que el webhook usa para aplicar el cambio.
3. **Verificación de firma de webhooks** implementada con `node:crypto` (esquema
   `t=...,v1=HMAC-SHA256`, tolerancia 5 min, `timingSafeEqual`) — pura y testeable sin cuenta.
   El endpoint del webhook parsea el body como string crudo (la firma cubre los bytes exactos).
4. **`MockPaymentGateway`** para local/tests: el checkout "cobra" al instante y la API aplica
   el cambio de plan de forma síncrona cuando `gateway.kind === 'mock'`. Selección por env:
   con `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` se usa Stripe; sin ellas, el mock.
5. **Enforcement de límites** en `apps/api/src/lib/limits.ts` leyendo `plans.limits` +
   `usage_events`/counts: usuarios y workflows → 403 FORBIDDEN; ejecuciones/mes → 429
   RATE_LIMITED. `-1` = ilimitado.

## Consecuencias

- Todo el flujo upgrade→límites funciona offline y en CI; Stripe test mode se activa solo
  con claves (paso del usuario, documentado en .env.example).
- La implementación Stripe no está verificada contra la API real hasta tener claves de test.
- Metered billing (usage-based) queda post-MVP; la tabla usage_events ya acumula la base.
