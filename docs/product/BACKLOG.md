# Backlog por fases — FlowHub AI

Cada ciclo deja el proyecto **funcionando y en verde** (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`).
Al cerrar un ciclo: actualizar `CLAUDE.md` §2/§12, README si aplica, y docs afectadas.

## ✅ Ciclos 1–2 — Discovery + documentación + scaffold (COMPLETADO)

- [x] Monorepo pnpm workspaces + Turborepo, TS estricto, ESLint, Prettier.
- [x] Estructura apps/ y packages/ con placeholders compilables.
- [x] Tipos core: shared (IDs, Result, AppError, TenantContext), workflow-engine (schema + estados), ai-gateway (AiProvider + mock), connectors (contrato), observability (Logger + redact), config (loadEnv).
- [x] docker-compose (PostgreSQL 16 + Redis 7), `.env.example`.
- [x] CI: ci.yml (format/lint/typecheck/test/build) + security.yml (audit + gitleaks).
- [x] Docs: CLAUDE.md, README, PRD, ARCHITECTURE, WORKFLOW_ENGINE, DATA_MODEL, SECURITY_MODEL, GCP_DEPLOYMENT, 9 ADRs, SECURITY.md, CONTRIBUTING.md, plantillas, CODEOWNERS, Dependabot.

## ⬜ Ciclo 3 — Scaffold técnico real

- [ ] `apps/web`: Next.js App Router + TS + Tailwind + shadcn/ui (página placeholder + healthcheck de API).
- [ ] `apps/api`: Fastify + fastify-type-provider-zod + @fastify/swagger (OpenAPI en `/docs`), helmet-equivalent headers, CORS desde env, rate limit básico, `/health`.
- [ ] `apps/worker`: proceso arrancable con conexión Redis y graceful shutdown (sin jobs aún).
- [ ] `packages/observability`: sustituir transporte console por pino manteniendo la interfaz `Logger`.
- [ ] Definir interfaz `JobQueue` (enqueue/schedule/process) en shared o paquete propio + implementación BullMQ.
- [ ] `pnpm dev` levanta web+api+worker en paralelo (turbo).
- [ ] Actualizar CI si hace falta (build de Next).

## ⬜ Ciclo 4 — Base de datos

- [ ] `packages/database`: Drizzle ORM + drizzle-kit, cliente pg, migraciones versionadas.
- [ ] Implementar las 23 tablas de `docs/architecture/DATA_MODEL.md` (users, organizations, organization_members, roles, permissions, workflow_templates, workflow_template_versions, installed_workflows, workflow_versions, workflow_nodes, workflow_edges, workflow_executions, workflow_execution_steps, workflow_execution_logs, connector_accounts, connector_secrets_metadata, ai_prompt_templates, ai_calls, audit_logs, marketplace_listings, usage_events, approval_requests, invitations).
- [ ] Seeds: organización demo, usuario demo, plantilla Invoice Intake Demo.
- [ ] Script `scripts/db-reset` (drop + migrate + seed) para desarrollo.
- [ ] Tests de repositorio básicos contra Postgres de docker-compose.

## ⬜ Ciclo 5 — API base

- [ ] Auth simple: registro/login con email+password (argon2), sesión con cookie firmada httpOnly. Diseñada para migrar a Auth.js/SSO después.
- [ ] Middleware de tenant: resuelve `TenantContext` en cada request autenticada; rechaza sin contexto.
- [ ] CRUD Organizations + members + invitaciones (mínimo).
- [ ] Endpoints: catálogo de templates, instalar workflow, listar installed_workflows, lanzar ejecución manual, listar ejecuciones/steps/logs, approval requests (listar/aprobar/rechazar).
- [ ] Audit log en acciones críticas.
- [ ] OpenAPI completo y validación Zod input/output en todos los endpoints.
- [ ] Tests de API (inyección de app Fastify) incluyendo tests de aislamiento cross-tenant.

## ⬜ Ciclo 6 — Workflow engine + worker

- [ ] Executor: recorre el grafo, persiste `workflow_executions` + steps + logs, maneja branches de condición.
- [ ] Handlers: trigger manual, transform, condition, wait (corto), approval (crea approval_request y pausa/reanuda), action (via connectors), ai (via ai-gateway mock).
- [ ] Conectores mock: gmail-mock, slack-mock, drive-mock, http-generic, webhook-inbound.
- [ ] Reintentos con backoff para fallos `retryable`; idempotencia por `(execution_id, node_id, attempt)`.
- [ ] Worker BullMQ consumiendo jobs de ejecución; API encola vía `JobQueue`.
- [ ] Workflow demo Invoice Intake completo end-to-end en local (seed).
- [ ] Tests del executor (caminos felices, fallos, reintentos, aprobación).

## ⬜ Ciclo 7 — Frontend MVP

- [ ] Login/registro y selector de organización.
- [ ] Dashboard: ejecuciones recientes, tasa de éxito, approvals pendientes.
- [ ] Catálogo de workflows + detalle + botón instalar.
- [ ] Detalle de installed workflow: ejecutar manualmente, historial.
- [ ] Detalle de ejecución: steps con estados, logs, datos de contexto.
- [ ] Bandeja de aprobaciones: aprobar/rechazar con comentario.
- [ ] Creación de workflow desde JSON con validación y errores claros.
- [ ] TanStack Query + Zod en el cliente; estados de carga/error cuidados.

## ⬜ Ciclo 8 — AI Gateway completo

- [ ] Prompt templates versionados (tabla ai_prompt_templates) + renderizado con variables.
- [ ] Structured output: JSON schema/Zod → validación de respuesta del provider.
- [ ] Providers reales opcionales: OpenAI y Anthropic activados por env vars (mock sigue siendo default).
- [ ] Persistencia de ai_calls (modelo, tokens, coste estimado, latencia, resultado).
- [ ] Guardrails: cap de coste mensual por organización (`AI_MONTHLY_COST_CAP_USD`), truncado de inputs, timeout.
- [ ] Nodo `ai` del engine usando el gateway completo.

## ⬜ Ciclo 9 — Hardening

- [ ] Tests de aislamiento multi-tenant sistemáticos (suite dedicada).
- [ ] Rate limiting por IP y por organización; revisión de headers de seguridad.
- [ ] CodeQL / code scanning activado; revisión de findings de gitleaks y pnpm audit.
- [ ] Revisión de deuda técnica documentada (lista en este fichero).
- [ ] Carga básica: 100 ejecuciones concurrentes en local sin corrupción de estado.
- [ ] Revisión de docs completa: CLAUDE.md, ARCHITECTURE, WORKFLOW_ENGINE al día.

## Post-MVP (sin ciclo asignado)

- Editor visual con React Flow (drag & drop de nodos).
- OAuth real: Google (Gmail/Drive), Slack; luego HubSpot, Notion, Stripe…
- Marketplace público: publicación por terceros, reviews, pagos y payouts (Stripe Connect).
- Billing real: Stripe subscriptions + metered usage.
- Scheduler (cron triggers) y webhooks entrantes públicos con verificación de firma.
- Export a BigQuery del event log (la abstracción ya está diseñada — ARCHITECTURE.md §9).
- SSO/SAML, SCIM, roles personalizados (Enterprise).
- Despliegue GCP real con Terraform + WIF (docs/deployment/GCP_DEPLOYMENT.md).
- Row-Level Security de PostgreSQL como segunda capa de aislamiento.
- Versionado/upgrade de workflows instalados cuando el template publica versión nueva.
