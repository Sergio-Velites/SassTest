# FlowHub AI

Plataforma SaaS B2B de **workflows empresariales instalables, con IA integrada y marketplace**.
Las empresas instalan procesos completos (gestión de facturas, onboarding, aprobación de gastos…),
los conectan a sus herramientas y los ejecutan con pasos de IA y aprobaciones humanas.

> **Estado: MVP completo (Ciclos 1–9).** Funciona end-to-end en local: registro,
> organizaciones multi-tenant, catálogo, instalación y ejecución de workflows con nodos IA
> (mock por defecto, OpenAI/Anthropic opcionales), aprobaciones humanas, historial y logs —
> desde la UI web y por API. Los items Post-MVP están en
> [docs/product/BACKLOG.md](docs/product/BACKLOG.md).

## Requisitos

- Node.js ≥ 22 (`.nvmrc`)
- pnpm ≥ 10 (`corepack enable` lo activa)
- Docker + Docker Compose (PostgreSQL y Redis locales)

## Instalación local

```bash
git clone <repo> && cd flowhub-ai
pnpm install
cp .env.example .env      # ajustar valores si hace falta; NUNCA commitear .env
pnpm db:up                # levanta PostgreSQL 16 + Redis 7 en Docker
pnpm build
pnpm test
```

## Variables de entorno

Todas las variables están documentadas en [`.env.example`](.env.example). Reglas:

- `.env` nunca se commitea (está en `.gitignore`).
- En cloud, los secretos viven en GCP Secret Manager, no en variables de CI.
- `AI_PROVIDER=mock` es el valor por defecto: todo funciona en local sin API keys.

## Comandos principales

| Comando                              | Descripción                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| `pnpm dev`                           | Levanta web+api+worker (requiere `pnpm db:up` y REDIS_URL) |
| `pnpm build`                         | Compila todos los paquetes (Turborepo)                     |
| `pnpm lint` / `pnpm typecheck`       | Calidad de código                                          |
| `pnpm test`                          | Tests (`node:test`)                                        |
| `pnpm format`                        | Prettier                                                   |
| `pnpm db:up` / `pnpm db:down`        | Infraestructura local en Docker                            |
| `pnpm --filter @flowhub/<pkg> <cmd>` | Comando en un paquete concreto                             |

## Arquitectura (resumen)

Monorepo pnpm + Turborepo:

```
apps/
  web/               → Frontend Next.js (placeholder; Ciclos 3 y 7)
  api/               → API Fastify + Zod + OpenAPI (placeholder; Ciclos 3 y 5)
  worker/            → Ejecutor asíncrono BullMQ (placeholder; Ciclo 6)
packages/
  shared/            → Tipos de dominio: IDs branded, Result, AppError, TenantContext
  workflow-engine/   → Schema del JSON de workflows, estados de ejecución, NodeHandler
  ai-gateway/        → Capa IA agnóstica de provider (mock/OpenAI/Anthropic)
  connectors/        → Contrato de conectores + mocks (Gmail, Slack, Drive, HTTP, webhook)
  database/          → Drizzle ORM + migraciones (Ciclo 4)
  config/            → Env tipado con Zod
  observability/     → Logging estructurado con redacción de secretos
  ui/                → Componentes compartidos (Ciclo 7)
```

Principios: multi-tenant por `organization_id` en cada tabla y query, validación Zod en
todos los bordes, IA solo a través del gateway con modo mock, cola de jobs tras interfaz
intercambiable para migrar a GCP sin reescribir lógica.

Detalle: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

## Roadmap

| Fase          | Contenido                                            |
| ------------- | ---------------------------------------------------- |
| ✅ Ciclos 1–2 | Monorepo, docs, ADRs, tipos core, CI                 |
| ✅ Ciclo 3    | Scaffold real de web (Next.js) y api (Fastify)       |
| ✅ Ciclo 4    | Base de datos: Drizzle, migraciones, seeds           |
| ✅ Ciclo 5    | API base: auth, organizations, workflows, executions |
| ✅ Ciclo 6    | Motor de workflows + worker + conectores mock        |
| ✅ Ciclo 7    | Frontend MVP (dashboard, catálogo, ejecuciones)      |
| ✅ Ciclo 8    | AI Gateway con providers reales opcionales           |
| ✅ Ciclo 9    | Hardening (tests, seguridad, CodeQL)                 |

Backlog detallado: [docs/product/BACKLOG.md](docs/product/BACKLOG.md).

## Documentación

- [CLAUDE.md](CLAUDE.md) — guía operativa para sesiones de Claude Code (estado, convenciones, "cómo añadir X")
- [docs/product/PRD.md](docs/product/PRD.md) — producto, MVP, modelo de negocio
- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) — arquitectura de sistema
- [docs/architecture/WORKFLOW_ENGINE.md](docs/architecture/WORKFLOW_ENGINE.md) — especificación del motor
- [docs/architecture/DATA_MODEL.md](docs/architecture/DATA_MODEL.md) — modelo de datos completo
- [docs/security/SECURITY_MODEL.md](docs/security/SECURITY_MODEL.md) — modelo de seguridad
- [docs/deployment/GCP_DEPLOYMENT.md](docs/deployment/GCP_DEPLOYMENT.md) — despliegue futuro en Google Cloud
- [docs/decisions/](docs/decisions/README.md) — ADRs
- [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
