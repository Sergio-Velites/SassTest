# Architecture Decision Records

Toda decisión de arquitectura relevante se registra aquí. Formato en `TEMPLATE.md`.
Los ADRs no se editan tras aceptarse: se sustituyen (`superseded by`).

| ADR                                         | Título                                            | Estado   |
| ------------------------------------------- | ------------------------------------------------- | -------- |
| [0001](ADR-0001-monorepo-pnpm-turborepo.md) | Monorepo con pnpm workspaces + Turborepo          | accepted |
| [0002](ADR-0002-frontend-nextjs.md)         | Frontend con Next.js App Router                   | accepted |
| [0003](ADR-0003-backend-fastify.md)         | Backend con Fastify + Zod                         | accepted |
| [0004](ADR-0004-postgresql-drizzle.md)      | PostgreSQL + Drizzle ORM                          | accepted |
| [0005](ADR-0005-job-queue-abstraction.md)   | Cola de jobs: BullMQ tras interfaz intercambiable | accepted |
| [0006](ADR-0006-multi-tenancy.md)           | Multi-tenancy: shared schema con organization_id  | accepted |
| [0007](ADR-0007-ai-provider-abstraction.md) | Abstracción de providers de IA (AI Gateway)       | accepted |
| [0008](ADR-0008-google-cloud-deployment.md) | Google Cloud como plataforma de despliegue        | accepted |
| [0009](ADR-0009-github-security.md)         | Seguridad del repositorio GitHub                  | accepted |
| [0010](ADR-0010-payment-gateway.md)         | Billing: Stripe test mode tras PaymentGateway     | accepted |
