# Arquitectura — FlowHub AI

**Última actualización:** 2026-07-04 (Ciclo 2). Mantener en sync con el código.

## 1. Vista de componentes

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Usuario (navegador)                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼──────────────────────────────────────┐
│  apps/web — Next.js App Router (SSR + client)                        │
│  UI: Tailwind + shadcn/ui (+ React Flow post-MVP)                    │
│  Datos: TanStack Query → API REST                                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST + cookies de sesión
┌──────────────────────────────▼──────────────────────────────────────┐
│  apps/api — Fastify + Zod + OpenAPI                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Middleware: auth → TenantContext → autorización → rate limit │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  Dominios: identity, tenants, catalog, builder, executions,          │
│            approvals, connectors, ai, audit, billing                 │
└───────┬───────────────────────────────┬─────────────────────────────┘
        │                               │ enqueue (JobQueue interface)
┌───────▼────────────────┐   ┌──────────▼──────────────────────────────┐
│ packages/database      │   │ Redis + BullMQ (local)                  │
│ Drizzle → PostgreSQL   │   │ → Pub/Sub | Cloud Tasks (GCP, futuro)   │
└───────▲────────────────┘   └──────────┬──────────────────────────────┘
        │                               │ consume
        │              ┌────────────────▼────────────────────────────┐
        └──────────────┤ apps/worker — ejecuta workflows              │
                       │  packages/workflow-engine (executor)         │
                       │  packages/connectors (mocks → reales)        │
                       │  packages/ai-gateway (mock|openai|anthropic) │
                       └──────────────────────────────────────────────┘

Transversales: packages/shared (tipos dominio) · packages/config (env) ·
packages/observability (logs estructurados + redact) · packages/ui (componentes)
```

## 2. Decisiones de arquitectura (resumen — detalle en ADRs)

| Decisión      | Elección                                    | Por qué (resumen)                                                                                                                | ADR  |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Monorepo      | pnpm workspaces + Turborepo                 | Tipos compartidos entre web/api/worker sin publicar paquetes; Turborepo simple y suficiente frente a Nx                          | 0001 |
| Frontend      | Next.js App Router                          | Estándar de facto, SSR para dashboard, despliegue limpio en Cloud Run                                                            | 0002 |
| Backend       | Fastify + Zod                               | Ligero, rápido, tipado end-to-end con fastify-type-provider-zod y OpenAPI derivado de los mismos schemas; menos magia que NestJS | 0003 |
| BD            | PostgreSQL + Drizzle                        | SQL explícito, migraciones SQL versionadas, arranque frío rápido en Cloud Run                                                    | 0004 |
| Jobs          | BullMQ tras interfaz `JobQueue`             | Local simple; swap a Pub/Sub o Cloud Tasks sin tocar negocio                                                                     | 0005 |
| Multi-tenancy | Shared schema + `organization_id`           | Coste operativo mínimo al inicio; RLS de Postgres como capa 2 futura                                                             | 0006 |
| IA            | Gateway con providers intercambiables       | Sin lock-in, coste trazado, mock para tests                                                                                      | 0007 |
| Cloud         | GCP: Cloud Run + Cloud SQL + Secret Manager | Requisito de producto; WIF sin claves estáticas                                                                                  | 0008 |

## 3. Servicios (runtime)

| Servicio     | Responsabilidad                                                  | Escalado futuro (GCP)                  |
| ------------ | ---------------------------------------------------------------- | -------------------------------------- |
| **web**      | UI, SSR, sesión de usuario                                       | Cloud Run, escala a 0                  |
| **api**      | REST, autorización, orquestación de dominio, encolar ejecuciones | Cloud Run, escala horizontal           |
| **worker**   | Ejecutar workflows paso a paso, reintentos, timers               | Cloud Run (min instances ≥ 1) o Jobs   |
| **postgres** | Datos transaccionales + event log inicial                        | Cloud SQL PostgreSQL                   |
| **redis**    | Cola BullMQ, locks                                               | Memorystore (o desaparece con Pub/Sub) |

## 4. Flujos principales

### 4.1 Instalar un workflow

1. `POST /installed-workflows` con `workflow_template_version_id` (+ configuración de variables).
2. API valida plan/límites del tenant → copia la definición del template a `installed_workflows` + `workflow_versions` (la instalación queda **desacoplada** del template: cambios del template no afectan a instalaciones).
3. Se registra en `audit_logs` y `usage_events`.

### 4.2 Ejecutar un workflow

1. `POST /installed-workflows/:id/executions` (trigger manual del MVP).
2. API crea `workflow_executions(status=pending)` y encola job vía `JobQueue`.
3. Worker toma el job: carga definición + contexto, ejecuta nodo a nodo (ver WORKFLOW_ENGINE.md), persiste `workflow_execution_steps` y logs por paso.
4. Nodos `approval` crean `approval_requests` y dejan la ejecución en `waiting_approval`; la resolución (API) re-encola la continuación.
5. Estado final: `succeeded` | `failed` | `cancelled`. Todo visible en la UI.

### 4.3 Llamada IA desde un nodo

1. Handler `ai` invoca `AiGateway.call({promptTemplateId, variables, outputSchema})`.
2. Gateway renderiza la plantilla versionada, aplica guardrails (tamaño, timeout, budget del tenant), llama al provider activo (`AI_PROVIDER`).
3. Valida el structured output contra el schema Zod; registra `ai_calls` (modelo, tokens, coste, latencia).
4. El resultado entra al contexto de ejecución bajo el id del nodo.

## 5. Multi-tenancy

- Cada organización = un tenant. **Toda** tabla de negocio lleva `organization_id NOT NULL`.
- `TenantContext` (organizationId, userId, role) se resuelve en el middleware de auth y viaja por API → jobs → engine. Sin contexto no hay acceso a datos.
- Repositorios filtran por `organization_id` siempre; los servicios re-asertan con `assertSameTenant` (defensa en profundidad).
- Cross-tenant se responde como `NOT_FOUND` para no filtrar existencia.
- Queries globales (jobs de sistema, métricas de plataforma) solo en módulos marcados `system-scope` y revisados.
- Capa 2 futura: PostgreSQL Row-Level Security con `SET app.current_org` (post-MVP, ver ADR-0006).

## 6. Seguridad (resumen — detalle en docs/security/SECURITY_MODEL.md)

- Auth por sesión (cookie httpOnly firmada) en MVP; diseñado para migrar a Auth.js/SSO.
- Autorización por rol de organización en cada endpoint; validación Zod input/output.
- Secretos de conectores cifrados, referenciados por id, nunca en definiciones ni logs.
- Logs con `redact()` obligatorio; auditoría de acciones críticas en `audit_logs`.
- CI con gitleaks + pnpm audit; sin credenciales cloud estáticas.

## 7. Escalabilidad

- **Fase local/MVP**: todo en un docker-compose; api y worker son procesos separados desde el día 1 (misma frontera que en cloud).
- **Fase cloud**: api/web stateless en Cloud Run (escala horizontal); worker escala por profundidad de cola. Postgres gestionado (Cloud SQL) con read replicas si hiciera falta.
- Los cuellos previsibles: (1) tabla `workflow_execution_logs` — particionado por mes cuando crezca; (2) ejecuciones concurrentes — el executor toma locks por ejecución, nunca globales; (3) coste IA — budgets por tenant.
- Nada de microservicios ni caches distribuidas hasta tener métricas que lo justifiquen.

## 8. Observabilidad

- Logs JSON estructurados (una línea por evento) con `organizationId`, `executionId`, `requestId` como campos estándar → Cloud Logging los indexa directamente.
- Redacción automática de claves sensibles en el logger (defensa en profundidad).
- Métricas MVP: derivadas de tablas (`workflow_executions`, `ai_calls`, `usage_events`).
- Cloud futuro: Error Reporting (stack traces), Cloud Monitoring (latencia API, profundidad de cola, error rate), alertas de presupuesto.

## 9. Estrategia de datos

- **Transaccional**: PostgreSQL, fuente de verdad (modelo en DATA_MODEL.md).
- **Eventos/analítica**: tabla `usage_events` (append-only) en PostgreSQL detrás de una interfaz `UsageEventSink` con una sola implementación (`PostgresUsageEventSink`). Cuando el volumen lo pida, se añade `BigQueryUsageEventSink` (dual-write o export batch) **sin tocar productores de eventos**. No se implementa BigQuery en MVP (decisión en ADR-0008).
- **Ficheros/documentos**: fuera de Postgres; en local `./storage` ignorado por git, en cloud Cloud Storage (misma interfaz `FileStorage`).
- **Retención**: logs de ejecución 90 días por defecto (retención extendida es upsell); audit_logs no se borran (soft-limits por plan).
- **Backups**: responsabilidad de Cloud SQL automated backups + PITR en cloud; en local, script de dump manual.
