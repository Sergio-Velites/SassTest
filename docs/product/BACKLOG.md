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

## ✅ Ciclo 5 — API base (COMPLETADO)

- [x] Auth: register/login/logout/me/switch-organization con argon2id, sesión server-side (tabla `sessions`, migración 0001, token opaco hasheado sha256, expiración deslizante 7d, revocación en logout) y cookie firmada httpOnly SameSite=Lax. Rate limit 10/min en `/auth/*`. Mismo error para email desconocido y password mal (sin account probing).
- [x] Middleware de tenant: `requireAuth(db)` resuelve sesión y re-valida membresía en cada request; `requireTenant(minRole)` fail-closed con jerarquía viewer<member<admin<owner. Cross-tenant responde NOT_FOUND.
- [x] Organizations: crear (activa el tenant en sesión, membership owner, subscription free), current, members; invitaciones con token hasheado + accept (un solo uso, expiración 7d). Todo con audit log.
- [x] Endpoints completos: catálogo, instalar workflow, crear desde JSON, listar/detalle installed; ejecuciones (lanzar manual con enqueue idempotente vía JobQueue, listar con filtro por workflow, detalle+context, steps, logs) y approvals (listar por estado, resolver con guard de rol/assignee, anti-doble-resolución y re-encolado de la ejecución).
- [x] Audit log en acciones críticas: organization.created, member.invited, member.joined, workflow.installed, workflow.created_from_json, session.organization_switched (+ usage_events en instalación).
- [x] OpenAPI completo en `/docs` y validación Zod de input/output en todos los endpoints (fastify-type-provider-zod).
- [x] 19 tests de API con inject + BD viva: auth lifecycle, invitaciones, instalación, validación JSON, RBAC, aislamiento cross-tenant (workflows y ejecuciones), enqueue idempotente y resolución de approvals con re-encolado.

## ✅ Ciclo 6 — Workflow engine + worker (COMPLETADO)

- [x] Executor re-entrante en `packages/workflow-engine` (`runExecution`): recorre el grafo, branches, snapshots de contexto, puerto `ExecutionStore` (el engine no toca BD; el worker aporta la implementación Drizzle), `InMemoryExecutionStore` para tests.
- [x] Handlers de los 7 kinds: trigger, transform (assign interpolado), condition (evaluador seguro sin eval), wait (pausa + resume por timestamp), approval (crea request, pausa, reanuda por rama approved/rejected/expired), action (registro de conectores), ai (provider mock; gateway completo en C8). Interpolación `{{nodes.*}}/{{variables.*}}/{{trigger.*}}` con lookup puro.
- [x] Conectores mock: gmail-mock, slack-mock, drive-mock, accounting-mock, http-generic (eco, sin red real hasta tener allowlist anti-SSRF), webhook-inbound + `createMockConnectorRegistry()`.
- [x] Reintentos con backoff exponencial 5s/25s/125s (máx 3, configurable por nodo, sleep inyectable), pasos succeeded nunca se re-ejecutan (idempotencia por (execution, node) + snapshots).
- [x] Worker BullMQ: `DrizzleExecutionStore` (re-scoping por organización en cada escritura), handlers `execution.run`/`execution.resume-wait`/`approval.expire`, re-validación de tenant contra BD antes de ejecutar (nunca se confía en el payload del job), `scheduleResume` → `queue.schedule`.
- [x] Invoice Intake Demo verificado end-to-end en local: register → org → instalar desde catálogo (seed) → ejecutar → succeeded con 8 steps y logs visibles vía API (API → BullMQ → worker → engine → Postgres). Migración 0002 añade `branch` a workflow_execution_steps; el endpoint de steps lo expone.
- [x] 8 tests del executor: Invoice Intake en sus 4 caminos (auto-registro, aprobación→register, rechazo, no-factura), reintentos agotados y con recuperación, wait con reloj falso, override de variables por instalación.

## ✅ Ciclo 7 — Frontend MVP (COMPLETADO)

- [x] Login/registro + onboarding de organización (el selector multi-org usa switch-organization de la API; UI de cambio rápido pendiente de pulido en C9).
- [x] Dashboard: workflows instalados, tasa de éxito, approvals pendientes con enlace, tabla de ejecuciones recientes con polling.
- [x] Catálogo con instalación en un clic (redirige al workflow instalado).
- [x] Detalle de workflow: ejecutar ahora, historial de ejecuciones, definición JSON.
- [x] Detalle de ejecución: steps con estado/intento/rama/output desplegable, logs con niveles coloreados, polling que se detiene en estados terminales.
- [x] Bandeja de aprobaciones: payload visible, aprobar/rechazar con comentario opcional.
- [x] Creación desde JSON con ejemplo precargado, error de sintaxis local y errores de validación del engine mostrados por campo.
- [x] TanStack Query + cliente API tipado que valida cada respuesta con Zod; estados de carga/error en todas las páginas. Nota: primitivas UI Tailwind propias — shadcn/ui se pospone al pulido visual post-MVP (evita una tanda grande de deps radix sin cambiar la funcionalidad). Verificado con e2e de navegador real (Playwright): registro→org→instalar→ejecutar→succeeded→approvals.

## ✅ Ciclo 8 — AI Gateway completo (COMPLETADO)

- [x] Prompt templates versionados: `PromptTemplateSource` con implementación Drizzle (los de organización pisan a los de sistema), id lógico `slug@version`, renderizado `{{var}}`.
- [x] Structured output: validación contra el output_schema del template (validador JSON-schema mínimo, ampliable a ajv); mismatch → traza `schema_mismatch` + error tipado no reintentable.
- [x] Providers reales: OpenAI y Anthropic sobre fetch (sin SDKs) con estimación de coste, seleccionados con `createProviderFromEnv` (AI_PROVIDER; fail-fast sin API key; mock default). Sin verificar contra APIs reales por no haber claves — cubierto por contrato.
- [x] Persistencia de ai_calls vía `AiCallSink` Drizzle (provider, modelo, tokens, coste, latencia, estado, error seguro) — verificado en vivo: 2 trazas por ejecución del demo.
- [x] Guardrails: cap mensual por organización (suma de ai_calls del mes vs AI_MONTHLY_COST_CAP_USD, bloquea antes de llamar al provider), truncado de variables (8k chars), timeout 30s por llamada.
- [x] Nodo `ai` del engine sobre el puerto `EngineAiPort` (AiGateway en producción, `providerPort(mock)` en tests); errores tipados con retriabilidad correcta (5xx sí, budget/schema/plantilla no).

## ✅ Ciclo 9 — Hardening (COMPLETADO)

- [x] Suite dedicada `tenant-isolation.test.ts`: dos organizaciones, sondeo sistemático de TODAS las superficies tenant-scoped con ids ajenos (siempre NOT_FOUND, nunca FORBIDDEN) + listados sin filas ajenas + verificación de que el propietario sí ve lo suyo.
- [x] Rate limiting: por IP global (300/min) + /auth/* (10/min, con test de 429) + **por organización** en lanzamiento de ejecuciones (OrgRateLimiter sliding-window 60/min, con test; en memoria por instancia — versión Redis en deuda técnica). Headers helmet verificados por test.
- [x] `pnpm audit --prod`: limpio (override de postcss <8.5.10, única moderate). gitleaks corre en CI. CodeQL: activación manual en settings del repo — checklist en infra/github/BRANCH_PROTECTION.md (no puede vivir en código).
- [x] Deuda técnica documentada (sección al final de este fichero).
- [x] Carga: 100 ejecuciones concurrentes (2 orgs × 50) por la API real → 100/100 succeeded, drenadas en ~5s, verificación de steps sin corrupción (4/4 succeeded, attempt=1).
- [x] Docs sincronizadas: CLAUDE.md §2/§12, README roadmap, este backlog.

## Deuda técnica (registrada en Ciclo 9)

- Migrar el workspace a zod 4 + fastify-type-provider-zod 7 (hoy fijados a zod 3 / provider 4).
- OrgRateLimiter en memoria → implementación Redis antes de escalar la API a varias instancias.
- shadcn/ui + pulido visual del frontend (primitivas Tailwind propias en el MVP).
- Selector rápido de organización en el header (la API ya soporta switch-organization).
- Providers reales de IA sin verificar contra APIs vivas (no hay claves); probar al configurarlas.
- Tests del frontend (hoy solo e2e manual con Playwright); considerar Playwright en CI.
- Particionado por mes de workflow_execution_logs cuando crezca el volumen.
- Editor visual: formularios de config generados desde los paramsSchema Zod de conectores/kinds (hoy el panel edita JSON con plantillas por tipo).
- RLS de PostgreSQL como segunda capa de aislamiento (diseñado en ADR-0006).
- commitlint en CI si aparecen commits fuera de convención.
- Job de borrado real de usuarios soft-deleted (GDPR art. 17).

## ✅ Ciclo 10 — Despliegue GCP (COMPLETADO el código/IaC; activación = pasos del propietario)

- [x] Dockerfiles multi-stage (pnpm deploy --legacy para bundles podados; base parametrizable `NODE_IMAGE`). Verificado en local: las 3 imágenes construyen, el job de migración corre, y el Invoice Intake Demo ejecuta `succeeded` atravesando SOLO contenedores. Job `docker-images` añadido al CI.
- [x] Módulo `stack` completo (APIs, VPC+PSA+connector, Cloud SQL 16 privado con backups/PITR y HA en prod, Memorystore, Artifact Registry, Secret Manager con secretos generados + IA vacíos, 4 SAs de mínimo privilegio, Cloud Run ×3 con probes/ingress correcto, WIF restringido al repo). `environments/staging|production` instanciables con `project_id`.
- [x] Runner de migraciones de producción (`packages/database/src/migrate.ts`, drizzle-orm migrator, sin drizzle-kit en runtime; `node node_modules/@flowhub/database/dist/migrate.js` en la imagen del api). Verificado idempotente contra BD limpia. Los paquetes declaran `files` para que pnpm deploy incluya dist/migrations.
- [x] `deploy.yml`: build+push por SHA → job de migraciones (`--wait`) → rollout de los 3 servicios → smoke de `/health`. Staging on main, production on release con GitHub environment. WIF, cero claves.
- [x] `terraform validate` en verde en ambos environments (mirror local de providers; el registry está bloqueado en este sandbox). `terraform plan` requiere ADC del propietario — es exactamente el paso documentado que queda.
- [x] Pasos del propietario documentados en `infra/terraform/README.md` (bucket de estado, tfvars, apply, variables de GitHub por environment) y GCP_DEPLOYMENT.md actualizado.
- **BLOQUEO EXTERNO**: crear proyectos `flowhub-staging`/`flowhub-prod` con billing y ejecutar el apply es del usuario; todo lo demás queda listo.

## ✅ Ciclo 11 — Framework de conectores reales + implementaciones

- [x] Infraestructura OAuth2 genérica: authorization code + PKCE (S256), state firmado HMAC en cookie httpOnly con TTL 10min, callback con exchange, cifrado AES-256-GCM (`SecretCipher` + `DbSecretsStore`, tabla connector_secrets en migración 0003, ref `local:<id>`), helper de refresh, revocación que borra el secreto. Testeado end-to-end contra token endpoint falso (PKCE verificado, state forjado rechazado).
- [x] API de cuentas de conector completa: GET /connectors (catálogo mock+real con disponibilidad), authorize/callback/list/revoke con audit y tenant scoping. UI en `/connectors`: catálogo real/mock con badges de disponibilidad, conexión OAuth (redirect a authorizationUrl), formularios api_key para email/holded, lista de cuentas con revocar, banners `?connected=`/`?error=` del callback. Verificado con e2e de navegador (Playwright).
- [x] Slack real (`chat.postMessage`, retriabilidad por rate limit) — activable con SLACK_CLIENT_ID/SECRET. Testeado con fetch inyectado.
- [x] Google real (Gmail readonly: fetch último email con adjunto y decodificación MIME básica; Drive: upload multipart) — activable con GOOGLE_CLIENT_ID/SECRET. Testeado con fetch inyectado; sin verificar contra API viva hasta tener OAuth app.
- [x] Email genérico: SMTP send (nodemailer) + IMAP fetch con adjunto (imapflow+mailparser), credenciales cifradas conectadas por API key endpoint. SMTP testeado (jsonTransport); IMAP sin verificar contra servidor vivo.
- [x] Holded por API key (create_entry → documento purchase). Testeado con fetch inyectado; QuickBooks queda como Post-MVP.
- [x] `createWorkerConnectorRegistry`: mocks siempre; los reales se suman con CONNECTOR_SECRETS_KEY. Resolución de credenciales tenant-scoped con refresh OAuth transparente (persistiendo tokens rotados) y error boundary tipado. El engine pasa `connectorAccountId` desde el config del nodo. Test de integración con BD viva (resolución, cross-tenant, cuenta faltante). Endpoint POST /connector-accounts/:slug/connect para api_key (email/holded).
- **BLOQUEO EXTERNO**: registrar las apps OAuth (Google Cloud Console, api.slack.com) y pasar client ids/secrets por Secret Manager/.env es del usuario.

## ✅ Ciclo 12 — Editor visual de workflows (React Flow)

- [x] Vista de grafo read-only en el detalle de workflow: componente `WorkflowGraph` (@xyflow/react v12) con auto-layout por capas (longest-path desde el trigger, acotado contra ciclos), nodos custom con badge por kind y detalle del config (conector/acción, template IA, expresión), etiquetas de rama en edges. Verificado con e2e Playwright sobre el Invoice Intake Demo (11 nodos/11 edges).
- [x] Edición en `/workflows/:id/edit`: añadir nodos por kind (con config por defecto documentado), eliminar nodos (limpia sus edges), conectar arrastrando entre handles, panel lateral por selección (nombre + config JSON por tipo de nodo; edges: rama editable + eliminar). Nota: el panel edita el config como JSON con plantillas por kind — los formularios generados desde paramsSchema Zod quedan como mejora post-MVP (deuda apuntada abajo).
- [x] Validación en vivo con el `workflowDefinitionSchema` real del engine (apps/web depende de @flowhub/workflow-engine) + parseo de JSON por nodo; los issues se listan y los nodos afectados se marcan en rojo; guardar se deshabilita hasta estar válido.
- [x] Guardar publica una nueva workflow_version: `PUT /workflows/:id` (valida con el engine, bump transaccional de is_current, regenera proyección, audit) + `GET /workflows/:id/versions`; historial visible en el detalle. Fix necesario: @fastify/cors por defecto solo permite GET/HEAD/POST — se añadió methods con PUT/PATCH/DELETE.
- [x] E2e Playwright del flujo completo: instalar → editar (añadir transform, validación en vivo con JSON roto → guardar deshabilitado → arreglar) → conectar por drag → guardar (v2 en historial) → ejecutar → succeeded con el nodo nuevo ejecutado por el worker.

## ⬜ Ciclo 13 — Billing Stripe (test mode)

- [ ] Integración Stripe Checkout + Customer Portal para suscripciones sobre las tablas plans/subscriptions existentes, tras interfaz `PaymentGateway` (mock para tests/local sin claves).
- [ ] Webhooks de Stripe (subscription created/updated/cancelled) con verificación de firma.
- [ ] Enforcement de límites de plan (usuarios, workflows, ejecuciones/mes) leyendo plans.limits + usage_events.
- [ ] Página de plan/upgrade en la web.
- **BLOQUEO EXTERNO**: cuenta Stripe y claves (test mode basta para todo el desarrollo) y precios definitivos.

## Post-MVP (sin ciclo asignado)

- OAuth de más conectores tras el Ciclo 11: HubSpot, Notion, Shopify…
- Marketplace público: publicación por terceros, reviews, pagos y payouts (Stripe Connect).
- Metered usage sobre Stripe (tras el Ciclo 13).
- Scheduler (cron triggers) y webhooks entrantes públicos con verificación de firma.
- Export a BigQuery del event log (la abstracción ya está diseñada — ARCHITECTURE.md §9).
- SSO/SAML, SCIM, roles personalizados (Enterprise).
- Row-Level Security de PostgreSQL como segunda capa de aislamiento.
- Versionado/upgrade de workflows instalados cuando el template publica versión nueva.
