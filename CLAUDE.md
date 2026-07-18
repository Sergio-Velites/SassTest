# CLAUDE.md — Guía para sesiones de Claude Code

> **Lee este documento completo antes de tocar código.** Es la fuente de verdad
> para continuar el desarrollo de FlowHub AI sin contexto externo.

## 1. Qué es este proyecto

**FlowHub AI** es un SaaS B2B de **workflows empresariales instalables con IA integrada y marketplace**.
Las empresas instalan procesos completos (gestión de facturas, onboarding de empleados,
aprobación de gastos, recuperación de clientes…), no automatizaciones sueltas.

- Un **workflow** es un proceso empaquetado: un grafo dirigido de **nodos**.
- Los nodos son: `trigger`, `action` (conector), `condition`, `ai`, `approval` (humana), `wait`, `transform`.
- Los usuarios instalan workflows desde un **marketplace**; los creadores publican gratis o de pago.
- **Multi-tenant desde el día 1**: cada organización es un tenant; todo dato pertenece a una organización.
- Funciona **en local sin desplegar** (docker-compose) y está preparado para **Google Cloud** después.

Objetivo de negocio: suscripción SaaS (Free → Enterprise) + comisión de marketplace + usage-based
(ejecuciones, llamadas IA, documentos). Detalle completo en `docs/product/PRD.md`.

## 2. Estado actual del proyecto

**Fase actual: BACKLOG MVP COMPLETO (Ciclos 1–9).** El MVP funciona end-to-end en local: registro→organización→catálogo→instalación→ejecución con IA mock y aprobaciones→historial/logs, desde la UI y por API, con 100 ejecuciones concurrentes verificadas. El usuario ha decidido (2026-07-18) continuar con TODO en este orden: **Ciclo 10 ✅** despliegue GCP hecho (Dockerfiles verificados, Terraform validado, deploy.yml; solo falta que el usuario cree los proyectos y aplique — pasos en infra/terraform/README.md), **Ciclo 11 ✅** conectores reales hechos (Slack, Google, IMAP/SMTP, Holded detrás de CONNECTOR_SECRETS_KEY; OAuth2+PKCE, secretos cifrados AES-256-GCM, UI `/connectors` con e2e; falta que el usuario registre las OAuth apps y pase client ids/secrets), **Ciclo 12** editor visual React Flow, **Ciclo 13** billing Stripe en test mode. IA se queda en mock por ahora. Detalle en `docs/product/BACKLOG.md`. — monorepo, docs,
tipos core, CI, las tres apps arrancan (`pnpm dev`) y la base de datos está implementada:
27 tablas Drizzle migradas y sembradas (`pnpm db:reset`). **La API de dominio está completa (auth, organizations, catálogo, workflows, ejecuciones, approvals — todo encolando vía JobQueue); faltan el motor que consume los jobs, los conectores mock y la UI real** — especificados en docs, llegan en
los ciclos siguientes (ver §12 y `docs/product/BACKLOG.md`).

Lo que existe y funciona:

- Monorepo pnpm workspaces + Turborepo. `pnpm build/lint/typecheck/test` en verde.
- `packages/shared`: IDs branded, `Result`, `AppError`, `TenantContext` + `assertSameTenant`. Con tests.
- `packages/workflow-engine`: schema Zod del JSON + **executor re-entrante completo** (`runExecution`): 7 handlers de nodo, interpolación, condiciones seguras, reintentos con backoff, pausas por wait/approval con reanudación por rama. Persistencia vía puerto `ExecutionStore` (implementación Drizzle en el worker; `InMemoryExecutionStore` para tests). Con 12 tests.
- `packages/ai-gateway`: **gateway completo** — `AiGateway` (plantillas versionadas, renderizado con truncado, timeout, validación de structured output, budget mensual, trazas obligatorias), providers OpenAI/Anthropic sobre fetch (sin SDKs, activados por env; no verificados contra API real), `createProviderFromEnv`, `providerPort` para tests. El nodo `ai` del engine usa el puerto `EngineAiPort`. Implementaciones Drizzle de source/sink/budget en `apps/worker/src/ai.ts`. 8+ tests.
- `packages/connectors`: contrato `Connector` + 6 mocks deterministas (gmail, slack, drive, accounting, http-generic eco, webhook-inbound) y `createMockConnectorRegistry()`.
- `packages/observability`: `Logger` estructurado sobre **pino** + `redact()` de secretos, destination inyectable para tests. Con tests.
- `packages/config`: `loadEnv()` validado con Zod.
- `apps/api`: Fastify real con helmet/CORS/rate-limit/swagger (`/docs`), `/health`, error handler `AppError`→HTTP, y **auth completa**: `/auth/register|login|logout|me|switch-organization` (argon2id, sesiones server-side en tabla `sessions`, cookie firmada httpOnly). Middleware `requireAuth(db)` + `requireTenant(minRole)` en `src/plugins/auth.ts` — TODO endpoint de dominio nuevo debe componer ambos. La API exige DATABASE_URL y AUTH_SESSION_SECRET al arrancar. Tests con inject + BD viva (skip sin DATABASE_URL). Nota: `fastify-type-provider-zod` fijado a `^4` (v7 exige zod 4).
- `packages/jobs`: abstracción `JobQueue` (ADR-0005) con `BullMqJobQueue` (Redis) e `InMemoryJobQueue` (tests). Payloads validados con Zod, dedup por idempotencyKey. Con tests.
- `apps/worker`: **worker completo** — `DrizzleExecutionStore` (implementación del puerto del engine, con re-scoping por organización en cada escritura), consume `execution.run`/`execution.resume-wait`/`approval.expire` de BullMQ con re-validación de tenant contra BD, MockAiProvider con respuestas canned de los prompts demo. Tests de integración contra Postgres vivo. **El Invoice Intake Demo corre end-to-end** (API→cola→worker→BD).
- `apps/web`: **frontend MVP completo** — login/registro/onboarding, dashboard, catálogo con instalación, detalle de workflow (ejecutar + historial), detalle de ejecución (steps/logs con polling), bandeja de aprobaciones, creación desde JSON. Cliente API tipado (`src/lib/api.ts`, valida todo con Zod) + hooks TanStack Query (`src/lib/hooks.ts`). Primitivas UI Tailwind propias (shadcn/ui pospuesto al pulido visual). Verificado con e2e de navegador (Playwright). Nota: zod fijado a ^3 también aquí.
- `packages/database`: **implementado** — 27 tablas Drizzle (schema en `src/schema/` por dominios), cliente `createDb`, migración 0000 (con citext), seeds idempotentes (`db:seed`), `pnpm db:reset`, tests contra BD viva que se saltan sin DATABASE_URL (CI levanta postgres:16 service).
- `packages/ui`: **placeholder** compilable.
- turbo.json declara `globalEnv` (turbo strict env mode): toda env var nueva debe añadirse ahí además de a `.env.example` y `packages/config`.
- docker-compose con PostgreSQL 16 + Redis 7. CI en GitHub Actions (ci.yml + security.yml).

## 3. Arquitectura general

```
apps/web (Next.js)  ──HTTP──▶  apps/api (Fastify + Zod + OpenAPI)
                                   │
                                   ├──▶ packages/database (Drizzle + PostgreSQL)
                                   ├──▶ packages/workflow-engine (validación + orquestación)
                                   └──▶ JobQueue (BullMQ + Redis) ──▶ apps/worker
                                                                        │
                                                                        ├──▶ packages/connectors (mocks)
                                                                        └──▶ packages/ai-gateway (mock/openai/anthropic)
```

Documentos de referencia (mantener en sync con el código):

- `docs/architecture/ARCHITECTURE.md` — componentes, flujos, multi-tenancy, escalabilidad.
- `docs/architecture/WORKFLOW_ENGINE.md` — especificación completa del motor (estados, reintentos, idempotencia, aprobaciones).
- `docs/architecture/DATA_MODEL.md` — las 23 tablas con columnas, índices y constraints. **Implementar Ciclo 4 desde aquí.**
- `docs/security/SECURITY_MODEL.md` — modelo de amenazas y reglas obligatorias.
- `docs/deployment/GCP_DEPLOYMENT.md` — despliegue futuro en Google Cloud.
- `docs/decisions/` — ADRs. Toda decisión importante nueva requiere un ADR.

## 4. Stack elegido (con ADR)

| Área             | Elección                                                                              | ADR      |
| ---------------- | ------------------------------------------------------------------------------------- | -------- |
| Monorepo         | pnpm workspaces + Turborepo                                                           | ADR-0001 |
| Frontend         | Next.js App Router, TS, Tailwind, shadcn/ui, React Flow, TanStack Query, Zustand, Zod | ADR-0002 |
| Backend          | Fastify + Zod (fastify-type-provider-zod) + OpenAPI                                   | ADR-0003 |
| Base de datos    | PostgreSQL 16 + Drizzle ORM                                                           | ADR-0004 |
| Jobs             | BullMQ + Redis tras interfaz `JobQueue` (swap a Pub/Sub o Cloud Tasks)                | ADR-0005 |
| Multi-tenancy    | Shared schema + `organization_id` + enforcement en aplicación                         | ADR-0006 |
| IA               | AI Gateway con providers intercambiables, mock obligatorio                            | ADR-0007 |
| Cloud            | Google Cloud (Cloud Run + Cloud SQL + Secret Manager), WIF sin claves JSON            | ADR-0008 |
| Seguridad GitHub | Branch protection, PRs obligatorias, scanning, Dependabot                             | ADR-0009 |

## 5. Convenciones de código

- TypeScript **estricto** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **`any` prohibido** (regla ESLint `error`). Si es inevitable: `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <motivo>`.
- Validación de todo input/output externo con **Zod**.
- Errores esperados → `Result<T, AppError>`; excepciones solo para bugs.
- IDs siempre **branded types** de `@flowhub/shared` (`OrganizationId`, `UserId`…), nunca `string` pelado.
- Módulos ESM (`"type": "module"`), imports relativos con extensión `.js`.
- Separación dominio / infraestructura / presentación. La lógica de negocio no importa SDKs (ni de IA ni de conectores) directamente.
- Logs: solo el `Logger` de `@flowhub/observability` (JSON estructurado + redacción automática). Nunca `console.log` en código de producto.
- Nombres de código y comentarios en **inglés**; documentación de repo en español.
- Commits: **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`).

## 6. Cómo ejecutar en local

```bash
pnpm install          # instalar dependencias
pnpm db:up            # PostgreSQL + Redis en Docker
cp .env.example .env  # y ajustar si hace falta
pnpm build            # compilar todos los paquetes
pnpm dev              # (cuando existan apps reales) modo desarrollo
```

## 7. Cómo testear

```bash
pnpm test                                   # todos los paquetes (Turbo)
pnpm --filter @flowhub/shared test          # un paquete concreto
pnpm lint && pnpm typecheck && pnpm build   # pipeline completo
```

Los tests usan `node:test` nativo (sin dependencias) y se ejecutan sobre `dist/` compilado:
los ficheros `*.test.ts` viven junto al código en `src/`. Si un paquete crece en necesidades
de testing (mocks de DB, fixtures), migrar a Vitest y documentarlo aquí.

## 8. Guías "cómo añadir X"

### Añadir un módulo/paquete al monorepo

1. Crear `packages/<nombre>/` con `package.json` (copiar de uno existente, nombre `@flowhub/<nombre>`), `tsconfig.json` (extiende `../../tsconfig.base.json`), `src/index.ts`, `README.md` breve.
2. Dependencias internas con `"@flowhub/x": "workspace:*"`.
3. `pnpm install` y verificar `pnpm build`.

### Añadir un tipo de nodo de workflow

1. Añadir el kind a `NODE_KINDS` en `packages/workflow-engine/src/definition.ts` **solo si es un tipo semánticamente nuevo** (preferir configuración de nodos existentes).
2. Implementar `NodeHandler` (contrato en `execution.ts`) y registrarlo en el registro de handlers (Ciclo 6).
3. Actualizar `docs/architecture/WORKFLOW_ENGINE.md` y añadir tests del handler.

### Añadir un conector

1. Implementar la interfaz `Connector` de `packages/connectors/src/connector.ts` en `packages/connectors/src/<slug>/`.
2. Definir `actions` con `paramsSchema` Zod por acción.
3. Los secretos NUNCA van en configs de nodos: se referencian por `connectorAccountId` y se resuelven en runtime.
4. Registrarlo en el registro de conectores y añadir tests con el mock.

### Añadir un provider de IA

1. Implementar `AiProvider` de `packages/ai-gateway/src/provider.ts`.
2. Añadir el nombre al enum `AI_PROVIDER` en `packages/config/src/index.ts` y a `.env.example`.
3. La selección de provider es por env var; la lógica de negocio no conoce providers concretos.
4. Toda llamada debe devolver `AiCallTrace` completo (modelo, tokens, coste, latencia).

### Trabajar con migraciones (a partir del Ciclo 4)

- Esquema en `packages/database/src/schema/` (Drizzle), migraciones SQL generadas con `drizzle-kit generate` y versionadas en el repo.
- Nunca editar una migración ya commiteada: crear una nueva.
- Toda tabla tenant-owned lleva `organization_id NOT NULL` + FK + índice compuesto `(organization_id, ...)`.
- El modelo objetivo está en `docs/architecture/DATA_MODEL.md`.

### Documentar decisiones

- Copiar `docs/decisions/TEMPLATE.md` → `ADR-NNNN-titulo-corto.md`, estado `accepted` al mergear.
- Actualizar el índice en `docs/decisions/README.md` y la tabla del §4 si cambia el stack.

## 9. Reglas de seguridad (obligatorias)

1. **Nunca** commitear secretos, `.env`, claves o tokens. Solo `.env.example` con placeholders.
2. Toda query a tablas tenant-owned filtra por `organization_id`. Sin excepciones sin revisión de seguridad.
3. Cross-tenant access se responde como `NOT_FOUND` (no `FORBIDDEN`) para no filtrar existencia.
4. Todo endpoint valida input y output con Zod y exige `TenantContext`.
5. No loguear tokens, credenciales ni PII innecesaria; usar siempre `redact()`/Logger de observability.
6. Acciones críticas (permisos, instalación de workflows, aprobaciones, conectores) → `audit_logs`.
7. GitHub Actions sin credenciales cloud estáticas: WIF/OIDC cuando llegue el despliegue.
8. Dependencias nuevas: justificar necesidad, preferir cero-deps para utilidades pequeñas.

Modelo completo: `docs/security/SECURITY_MODEL.md`.

## 10. Qué NO hacer

- No implementar OAuth real de conectores en el MVP (la interfaz ya lo contempla; la implementación es post-MVP).
- No implementar cobro real (Stripe) en el MVP — solo entidades de billing.
- No añadir BigQuery aún — el event log vive en PostgreSQL tras una abstracción (ver ARCHITECTURE.md §9).
- No usar claves JSON de service accounts de GCP.
- No acoplar prompts de IA en lógica de negocio — siempre plantillas versionadas vía ai-gateway.
- No hacer queries globales sin tenant salvo procesos de sistema explícitamente documentados.
- No dejar el repo en rojo: cada ciclo termina con `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.
- No sobreconstruir: no añadir GraphQL, microservicios ni caches hasta que haya una necesidad medida.

## 11. Checklist antes de cada commit

- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.
- [ ] Sin secretos ni ficheros `.env` en `git status`.
- [ ] Docs actualizadas si cambió arquitectura, modelo de datos, seguridad o el estado del proyecto (este fichero §2).
- [ ] ADR creado si hubo decisión de arquitectura.
- [ ] Mensaje de commit en Conventional Commits.

## 12. Próximas fases (resumen — detalle en docs/product/BACKLOG.md)

| Ciclo | Contenido                                                                          | Estado      |
| ----- | ---------------------------------------------------------------------------------- | ----------- |
| 1–2   | Estructura, documentación, ADRs, tipos core, CI                                    | ✅ Hecho    |
| 3     | Scaffold real: Next.js en `apps/web`, Fastify en `apps/api`, pino en observability | ✅ Hecho    |
| 4     | `packages/database`: Drizzle, migraciones de las 23+ tablas, seeds                 | ✅ Hecho    |
| 5     | API base: auth ✅ + tenant middleware ✅; organizations, workflows, executions     | ✅ Hecho    |
| 6     | Workflow engine + worker: executor, handlers, mocks, demo e2e                      | ✅ Hecho    |
| 7     | Frontend MVP: login, dashboard, catálogo, ejecuciones, approvals, JSON             | ✅ Hecho    |
| 8     | AI Gateway completo: templates BD, structured output, budget, providers reales     | ✅ Hecho    |
| 9     | Hardening: aislamiento, rate limiting, audit, carga, deuda técnica                 | ✅ Hecho    |
| 10    | Despliegue GCP: Dockerfiles, Terraform, deploy.yml con WIF (apply es del usuario)  | ✅ Hecho    |
| 11    | Conectores reales: OAuth2+PKCE, secretos cifrados, Slack/Google/email/Holded, UI   | ✅ Hecho    |
| 12    | Editor visual de workflows con React Flow                                          | ⬜ Pendiente |
| 13    | Billing Stripe test mode: PaymentGateway, webhooks, límites de plan, upgrade       | ⬜ Pendiente |

**Decisiones pendientes** (resolver con el usuario cuando toque):

- Nombre definitivo del producto y dominio (FlowHub AI es provisional).
- Auth del MVP: sesión propia con cookies vs. proveedor (Auth.js). Propuesta: sesión propia simple, migrable.
- Elección final de librería de rate limiting y de client HTTP para conectores.
- Plan de precios definitivo (los del PRD son orientativos).

## 13. Al terminar cada ciclo

1. Ejecuta el pipeline completo y déjalo en verde.
2. Actualiza **§2 (estado)** y **§12 (fases)** de este fichero.
3. Actualiza `README.md` si cambian comandos o requisitos.
4. Actualiza los docs afectados y crea ADRs de decisiones nuevas.
5. Lista decisiones pendientes y próximos pasos en el resumen final al usuario.
6. Commit con Conventional Commits y push a la rama de trabajo.
