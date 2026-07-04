# Modelo de datos — FlowHub AI

**Especificación para el Ciclo 4** (implementar con Drizzle en `packages/database`).
PostgreSQL 16. Última actualización: 2026-07-04.

## Convenciones globales

Salvo indicación contraria, **toda tabla** incluye:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()` (trigger o capa ORM)
- Tablas tenant-owned: `organization_id uuid NOT NULL REFERENCES organizations(id)` + índice compuesto que empieza por `organization_id`
- `deleted_at timestamptz NULL` solo donde se indica (soft delete)
- `created_by uuid REFERENCES users(id)` donde se indica
- Enums como `text` + `CHECK` constraint (más simple de migrar que enums nativos)
- Nombres snake_case; jsonb para estructuras flexibles validadas por Zod en aplicación

## Identity & Tenancy

### users _(global, no tenant)_

| Columna       | Tipo                           | Notas                                    |
| ------------- | ------------------------------ | ---------------------------------------- |
| email         | citext UNIQUE NOT NULL         | login                                    |
| password_hash | text NULL                      | argon2; NULL cuando llegue SSO           |
| name          | text NOT NULL                  |                                          |
| status        | text NOT NULL DEFAULT 'active' | CHECK: active/suspended                  |
| deleted_at    | timestamptz                    | soft delete (GDPR: borrado real vía job) |

### organizations _(la raíz del tenant)_

| Columna    | Tipo                         | Notas                                       |
| ---------- | ---------------------------- | ------------------------------------------- |
| name       | text NOT NULL                |                                             |
| slug       | citext UNIQUE NOT NULL       | para URLs                                   |
| plan       | text NOT NULL DEFAULT 'free' | CHECK: free/starter/pro/business/enterprise |
| created_by | uuid → users                 |                                             |
| deleted_at | timestamptz                  |                                             |

### organization_members

| Columna                                           | Tipo                 | Notas                            |
| ------------------------------------------------- | -------------------- | -------------------------------- |
| organization_id                                   | uuid → organizations |                                  |
| user_id                                           | uuid → users         |                                  |
| role                                              | text NOT NULL        | CHECK: owner/admin/member/viewer |
| UNIQUE(organization_id, user_id) · INDEX(user_id) |                      |                                  |

### roles / permissions _(catálogo de permisos finos — Business/Enterprise)_

- `roles`: organization_id NULL para roles de sistema (owner/admin/member/viewer sembrados), NOT NULL para roles custom; `name`, `description`. UNIQUE(organization_id, name).
- `permissions`: tabla global de catálogo — `key` (p.ej. `workflows:install`, `approvals:resolve`), `description`. Join table `role_permissions(role_id, permission_key)`.
- MVP: solo roles de sistema; el enforcement usa `organization_members.role`. Las tablas existen para no migrar el modelo después.

### invitations

| Columna                       | Tipo                 | Notas                                             |
| ----------------------------- | -------------------- | ------------------------------------------------- |
| organization_id               | uuid → organizations |                                                   |
| email                         | citext NOT NULL      |                                                   |
| role                          | text NOT NULL        | mismo CHECK que members                           |
| token_hash                    | text UNIQUE NOT NULL | se envía token en claro por email; se guarda hash |
| expires_at                    | timestamptz NOT NULL |                                                   |
| accepted_at / revoked_at      | timestamptz          |                                                   |
| created_by                    | uuid → users         |                                                   |
| INDEX(organization_id, email) |                      |                                                   |

## Workflow Catalog

### workflow_templates _(publicables; tenant del creador)_

| Columna                                                                | Tipo                          | Notas                                     |
| ---------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| organization_id                                                        | uuid → organizations          | organización creadora                     |
| name, description                                                      | text                          |                                           |
| category                                                               | text NOT NULL                 | CHECK: finance/hr/sales/support/ops/other |
| status                                                                 | text NOT NULL DEFAULT 'draft' | CHECK: draft/private/published/deprecated |
| created_by                                                             | uuid → users                  |                                           |
| deleted_at                                                             | timestamptz                   |                                           |
| INDEX(organization_id, status) · INDEX(status, category) para catálogo |                               |                                           |

### workflow_template_versions _(inmutables al publicar)_

| Columna                               | Tipo                      | Notas                                 |
| ------------------------------------- | ------------------------- | ------------------------------------- |
| workflow_template_id                  | uuid → workflow_templates |                                       |
| version                               | text NOT NULL             | semver                                |
| definition                            | jsonb NOT NULL            | validado por workflowDefinitionSchema |
| changelog                             | text                      |                                       |
| published_at                          | timestamptz NULL          | NULL = borrador de versión            |
| created_by                            | uuid → users              |                                       |
| UNIQUE(workflow_template_id, version) |                           |                                       |

### marketplace_listings

| Columna                                    | Tipo                             | Notas                            |
| ------------------------------------------ | -------------------------------- | -------------------------------- |
| workflow_template_id                       | uuid UNIQUE → workflow_templates |                                  |
| price_cents                                | integer NOT NULL DEFAULT 0       | 0 = gratis                       |
| currency                                   | text NOT NULL DEFAULT 'EUR'      |                                  |
| billing_type                               | text NOT NULL DEFAULT 'one_time' | CHECK: one_time/subscription     |
| verified                                   | boolean NOT NULL DEFAULT false   | badge de certificación           |
| rating_avg numeric(3,2) / rating_count int |                                  | agregados desnormalizados        |
| status                                     | text NOT NULL DEFAULT 'inactive' | CHECK: inactive/active/suspended |

## Workflows instalados

### installed_workflows

| Columna                        | Tipo                                   | Notas                                                |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| organization_id                | uuid → organizations                   | tenant instalador                                    |
| workflow_template_version_id   | uuid NULL → workflow_template_versions | NULL si fue creado desde JSON propio                 |
| name                           | text NOT NULL                          | editable por el cliente                              |
| status                         | text NOT NULL DEFAULT 'active'         | CHECK: active/paused/archived                        |
| config                         | jsonb NOT NULL DEFAULT '{}'            | valores de variables + mapping de connector_accounts |
| created_by                     | uuid → users                           |                                                      |
| deleted_at                     | timestamptz                            |                                                      |
| INDEX(organization_id, status) |                                        |                                                      |

### workflow_versions _(versiones locales de la instalación)_

| Columna                                | Tipo                           | Notas                                                   |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| organization_id                        | uuid                           | desnormalizado para aislamiento directo                 |
| installed_workflow_id                  | uuid → installed_workflows     |                                                         |
| version                                | integer NOT NULL               | autoincremental por instalación                         |
| definition                             | jsonb NOT NULL                 | fuente de verdad ejecutable                             |
| is_current                             | boolean NOT NULL DEFAULT false | una sola current por instalación (índice parcial único) |
| created_by                             | uuid → users                   |                                                         |
| UNIQUE(installed_workflow_id, version) |                                |                                                         |

### workflow_nodes / workflow_edges _(proyección desnormalizada de la definition para queries/editor; la jsonb es la fuente de verdad)_

- `workflow_nodes`: organization_id, workflow_version_id → workflow_versions, node_id (slug en la definición), kind (CHECK de los 7 kinds), name, config jsonb. UNIQUE(workflow_version_id, node_id).
- `workflow_edges`: organization_id, workflow_version_id, from_node_id, to_node_id, branch text NULL. INDEX(workflow_version_id).
- Se regeneran al guardar una versión (nunca se editan sueltas).

## Ejecución

### workflow_executions

| Columna                                                                                         | Tipo                            | Notas                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| organization_id                                                                                 | uuid                            |                                                                            |
| installed_workflow_id                                                                           | uuid → installed_workflows      |                                                                            |
| workflow_version_id                                                                             | uuid → workflow_versions        | versión exacta ejecutada                                                   |
| status                                                                                          | text NOT NULL DEFAULT 'pending' | CHECK: pending/running/waiting/waiting_approval/succeeded/failed/cancelled |
| trigger_type                                                                                    | text NOT NULL                   | CHECK: manual/webhook/schedule                                             |
| context                                                                                         | jsonb NOT NULL DEFAULT '{}'     | snapshot del ExecutionContextData                                          |
| current_node_id                                                                                 | text NULL                       | dónde está/quedó                                                           |
| error                                                                                           | jsonb NULL                      | {code, message} del fallo terminal                                         |
| started_at / finished_at                                                                        | timestamptz                     |                                                                            |
| created_by                                                                                      | uuid → users                    | quién disparó (NULL si sistema)                                            |
| INDEX(organization_id, installed_workflow_id, created_at DESC) · INDEX(organization_id, status) |                                 |                                                                            |

### workflow_execution_steps

| Columna                                                                                | Tipo                       | Notas                                           |
| -------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------- |
| organization_id                                                                        | uuid                       |                                                 |
| workflow_execution_id                                                                  | uuid → workflow_executions |                                                 |
| node_id                                                                                | text NOT NULL              | slug del nodo                                   |
| node_kind                                                                              | text NOT NULL              |                                                 |
| status                                                                                 | text NOT NULL              | CHECK: pending/running/succeeded/failed/skipped |
| attempt                                                                                | integer NOT NULL DEFAULT 1 | último intento                                  |
| input / output                                                                         | jsonb                      | sanitizados (sin secretos)                      |
| error                                                                                  | jsonb NULL                 |                                                 |
| started_at / finished_at                                                               | timestamptz                |                                                 |
| UNIQUE(workflow_execution_id, node_id) · INDEX(organization_id, workflow_execution_id) |                            |                                                 |

### workflow_execution_logs _(append-only; candidata a particionado por mes)_

| Columna                                  | Tipo                                 | Notas                          |
| ---------------------------------------- | ------------------------------------ | ------------------------------ |
| organization_id                          | uuid                                 |                                |
| workflow_execution_id                    | uuid → workflow_executions           |                                |
| step_id                                  | uuid NULL → workflow_execution_steps |                                |
| level                                    | text NOT NULL                        | CHECK: debug/info/warn/error   |
| message                                  | text NOT NULL                        | ya redactado por observability |
| fields                                   | jsonb                                | contexto estructurado          |
| created_at                               | timestamptz                          | sin updated_at (inmutable)     |
| INDEX(workflow_execution_id, created_at) |                                      |                                |

### approval_requests

| Columna                                                          | Tipo                            | Notas                                              |
| ---------------------------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| organization_id                                                  | uuid                            |                                                    |
| workflow_execution_id                                            | uuid → workflow_executions      |                                                    |
| node_id                                                          | text NOT NULL                   |                                                    |
| title / description                                              | text                            |                                                    |
| payload                                                          | jsonb                           | datos a revisar por el humano                      |
| required_role                                                    | text NOT NULL DEFAULT 'member'  | rol mínimo para resolver                           |
| assignee_user_id                                                 | uuid NULL → users               | opcional                                           |
| status                                                           | text NOT NULL DEFAULT 'pending' | CHECK: pending/approved/rejected/expired/cancelled |
| resolved_by                                                      | uuid NULL → users               |                                                    |
| resolved_at                                                      | timestamptz                     |                                                    |
| resolution_comment                                               | text                            |                                                    |
| expires_at                                                       | timestamptz NULL                |                                                    |
| INDEX(organization_id, status) · INDEX(assignee_user_id, status) |                                 |                                                    |

## Conectores

### connector_accounts

| Columna                                | Tipo                           | Notas                                     |
| -------------------------------------- | ------------------------------ | ----------------------------------------- |
| organization_id                        | uuid                           |                                           |
| connector_slug                         | text NOT NULL                  | p.ej. 'slack-mock'                        |
| name                                   | text NOT NULL                  | etiqueta del usuario ("Slack de soporte") |
| auth_type                              | text NOT NULL                  | CHECK: none/api_key/oauth2                |
| status                                 | text NOT NULL DEFAULT 'active' | CHECK: active/revoked/error               |
| created_by                             | uuid → users                   |                                           |
| deleted_at                             | timestamptz                    |                                           |
| INDEX(organization_id, connector_slug) |                                |                                           |

### connector_secrets_metadata _(los secretos NO viven aquí)_

| Columna                            | Tipo                      | Notas                                                                                                              |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| organization_id                    | uuid                      |                                                                                                                    |
| connector_account_id               | uuid → connector_accounts |                                                                                                                    |
| secret_ref                         | text NOT NULL             | referencia al backend de secretos (local: fila cifrada AES-256-GCM en tabla aparte; GCP: nombre en Secret Manager) |
| kind                               | text NOT NULL             | CHECK: api_key/oauth_tokens                                                                                        |
| rotated_at / expires_at            | timestamptz               |                                                                                                                    |
| UNIQUE(connector_account_id, kind) |                           |                                                                                                                    |

## IA

### ai_prompt_templates

| Columna                                | Tipo             | Notas                                     |
| -------------------------------------- | ---------------- | ----------------------------------------- |
| organization_id                        | uuid NULL        | NULL = plantilla de sistema (first-party) |
| slug                                   | text NOT NULL    | p.ej. 'invoice-classify'                  |
| version                                | integer NOT NULL | el id lógico es `slug@version`            |
| template                               | text NOT NULL    | con placeholders {{var}}                  |
| output_schema                          | jsonb NULL       | JSON schema del structured output         |
| model_hint                             | text NULL        | modelo recomendado, no obligatorio        |
| UNIQUE(organization_id, slug, version) |                  |                                           |

### ai_calls _(traza obligatoria de toda llamada IA)_

| Columna                                 | Tipo                             | Notas                                   |
| --------------------------------------- | -------------------------------- | --------------------------------------- |
| organization_id                         | uuid                             |                                         |
| workflow_execution_id / step_id         | uuid NULL                        | origen si vino del engine               |
| prompt_template_id                      | uuid → ai_prompt_templates       |                                         |
| provider                                | text NOT NULL                    | mock/openai/anthropic/gemini            |
| model                                   | text NOT NULL                    |                                         |
| input_tokens / output_tokens            | integer                          |                                         |
| estimated_cost_usd                      | numeric(10,6) NOT NULL DEFAULT 0 |                                         |
| latency_ms                              | integer                          |                                         |
| status                                  | text NOT NULL                    | CHECK: succeeded/failed/schema_mismatch |
| error                                   | jsonb NULL                       | sin contenido sensible                  |
| created_at                              | timestamptz                      | inmutable                               |
| INDEX(organization_id, created_at DESC) | budgets y reporting              |                                         |

## Auditoría, uso y billing

### audit_logs _(append-only, nunca se borra)_

| Columna                                                                  | Tipo              | Notas                                                                  |
| ------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------- |
| organization_id                                                          | uuid              |                                                                        |
| actor_user_id                                                            | uuid NULL → users | NULL = sistema                                                         |
| action                                                                   | text NOT NULL     | p.ej. 'workflow.installed', 'approval.resolved', 'member.role_changed' |
| resource_type / resource_id                                              | text / uuid       |                                                                        |
| metadata                                                                 | jsonb             | redactado                                                              |
| ip_address                                                               | inet NULL         |                                                                        |
| created_at                                                               | timestamptz       | inmutable                                                              |
| INDEX(organization_id, created_at DESC) · INDEX(organization_id, action) |                   |                                                                        |

### usage_events _(append-only; detrás de UsageEventSink — futuro export a BigQuery)_

| Columna                                         | Tipo                       | Notas                                                     |
| ----------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| organization_id                                 | uuid                       |                                                           |
| event_type                                      | text NOT NULL              | 'execution.completed', 'ai.call', 'document.processed', … |
| quantity                                        | numeric NOT NULL DEFAULT 1 |                                                           |
| metadata                                        | jsonb                      |                                                           |
| occurred_at                                     | timestamptz NOT NULL       |                                                           |
| INDEX(organization_id, event_type, occurred_at) | agregación para billing    |                                                           |

### Billing (placeholders del MVP — sin cobro real)

- `plans` _(global)_: slug (free/starter/pro/business/enterprise), price_cents, currency, limits jsonb (usuarios, workflows, ejecuciones/mes, presupuesto IA).
- `subscriptions`: organization_id UNIQUE, plan_slug → plans, status (CHECK: active/trialing/past_due/cancelled), current_period_start/end, external_ref text NULL (futuro id de Stripe).
- `invoices` _(placeholder)_: organization_id, period_start/end, amount_cents, status (CHECK: draft/issued/paid/void), line_items jsonb.
- `marketplace_payouts` _(placeholder)_: organization_id (creador), period, gross_cents, commission_cents, net_cents, status (CHECK: pending/paid).

## Reglas de implementación (Ciclo 4)

1. Migraciones generadas con drizzle-kit, revisadas a mano, inmutables una vez commiteadas.
2. FKs `ON DELETE RESTRICT` por defecto (los borrados van por soft delete + jobs de limpieza); `CASCADE` solo de ejecución → steps/logs.
3. `citext` para emails/slugs (extensión); `gen_random_uuid()` de pgcrypto/pg16.
4. Seeds mínimos: plans, permisos de catálogo, organización+usuario demo, template Invoice Intake Demo con una versión publicada.
5. Tests de aislamiento: dos organizaciones sembradas; toda query de repositorio debe devolver solo datos de la organización del contexto.
