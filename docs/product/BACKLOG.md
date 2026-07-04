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

## ✅ Ciclo 3 — Scaffold técnico real (COMPLETADO)

- [x] `apps/web`: Next.js 15 App Router + TS + Tailwind 4 con página de estado + healthcheck de la API (client component). `output: 'standalone'` para Cloud Run. shadcn/ui se inicializa en el Ciclo 7 junto a la UI real.
- [x] `apps/api`: Fastify + fastify-type-provider-zod + @fastify/swagger (OpenAPI en `/docs`), helmet headers, CORS desde env, rate limit básico, `/health`, error handler AppError→HTTP, tests con inject. (Nota: fastify-type-provider-zod fijado a ^4 mientras el workspace use zod 3; migrar a zod 4 + provider 7 como tarea de Ciclo 9.)
- [x] `apps/worker`: proceso arrancable con conexión Redis (`queue.ready()` falla rápido con REDIS_URL inválida) y graceful shutdown. Sin handlers aún (llegan con el executor en Ciclo 6).
- [x] `packages/observability`: transporte pino manteniendo la interfaz `Logger` (messageKey/level compatibles con Cloud Logging, destination inyectable para tests). 5 tests.
- [x] Interfaz `JobQueue` en paquete propio `@flowhub/jobs` (enqueue/schedule/process/ready/close) + `BullMqJobQueue` (subconjunto portable de BullMQ) + `InMemoryJobQueue` para tests, con validación Zod de payloads y dedup por idempotencyKey. 6 tests.
- [x] `pnpm dev` levanta web+api+worker en paralelo (turbo). Requiere `pnpm db:up` y REDIS_URL (el worker hace fail-fast sin Redis, por diseño). `globalEnv` declarado en turbo.json (turbo strict env mode).
- [x] CI revisado: `pnpm build` cubre `next build` sin cambios adicionales.

## ✅ Ciclo 4 — Base de datos (COMPLETADO)

- [x] `packages/database`: Drizzle ORM + drizzle-kit, cliente pg (`createDb` con pool inyectable), migración inicial 0000 versionada (incluye extensión citext).
- [x] 27 tablas implementadas según `docs/architecture/DATA_MODEL.md` (las 23 core + role_permissions, plans, subscriptions, invoices, marketplace_payouts) con CHECKs, índices compuestos por organization_id, índice parcial único de versión current y citext para emails/slugs.
- [x] Seeds idempotentes: planes, catálogo de permisos, org+usuario demo, plantilla Invoice Intake Demo publicada (definición validada con workflowDefinitionSchema) y prompts IA de sistema. Guard anti-producción.
- [x] `pnpm db:reset` (scripts/db-reset.sh): drop + migrate + seed, verificado end-to-end.
- [x] Tests contra Postgres vivo (aislamiento de tenant, índice parcial único, CHECK constraints) que se saltan sin DATABASE_URL; CI levanta postgres:16 como service y aplica migraciones antes de testear.

## ⬜ Ciclo 5 — API base

- [x] Auth: register/login/logout/me/switch-organization con argon2id, sesión server-side (tabla `sessions`, migración 0001, token opaco hasheado sha256, expiración deslizante 7d, revocación en logout) y cookie firmada httpOnly SameSite=Lax. Rate limit 10/min en `/auth/*`. Mismo error para email desconocido y password mal (sin account probing).
- [x] Middleware de tenant: `requireAuth(db)` resuelve sesión y re-valida membresía en cada request; `requireTenant(minRole)` fail-closed con jerarquía viewer<member<admin<owner. Cross-tenant responde NOT_FOUND.
- [x] Organizations: crear (activa el tenant en sesión, membership owner, subscription free), current, members; invitaciones con token hasheado + accept (un solo uso, expiración 7d). Todo con audit log.
- [~] Endpoints: catálogo (solo templates published, con versiones), instalar workflow (copia la definición, solo versiones publicadas), crear workflow desde JSON (validado por el engine con errores claros), listar/detalle de installed workflows. **Faltan: ejecuciones (lanzar/listar/steps/logs) y approvals** — dependen del enqueue vía JobQueue (siguiente bloque).
- [x] Audit log en acciones críticas: organization.created, member.invited, member.joined, workflow.installed, workflow.created_from_json, session.organization_switched (+ usage_events en instalación).
- [ ] OpenAPI completo y validación Zod input/output en todos los endpoints.
- [~] Tests de API con inject + BD viva: lifecycle de sesión, CONFLICT, cookies forjadas, aislamiento en switch-organization (10 tests). Faltan los tests de los endpoints de dominio restantes.

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
