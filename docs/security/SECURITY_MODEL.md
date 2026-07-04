# Modelo de seguridad — FlowHub AI

**Última actualización:** 2026-07-04. Complementa `SECURITY.md` (política de reporte)
y `CLAUDE.md` §9 (reglas operativas). Los controles marcados **[MVP]** son exigibles ya;
**[Post-MVP]** están diseñados pero no implementados.

## 1. Modelo de amenazas

Activos a proteger: datos de negocio de cada tenant (facturas, empleados, clientes),
credenciales de conectores, definiciones de workflows (know-how), trazas de IA.

| #   | Amenaza                                | Vector                                                                   | Controles                                                                                                                                                                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Acceso cross-tenant                    | IDOR, query sin filtro de organización, payload de job manipulado        | `organization_id` en toda tabla y query [MVP]; `assertSameTenant` en servicios [MVP]; respuesta NOT_FOUND [MVP]; re-validación de tenant al consumir jobs [MVP]; RLS de Postgres [Post-MVP]; suite de tests de aislamiento [MVP-C9] |
| T2  | Robo de credenciales de conectores     | Fuga en logs, dump de BD, XSS                                            | Secretos fuera de la BD principal (secret_ref) [MVP]; cifrado AES-256-GCM local / Secret Manager en GCP [MVP diseño]; `redact()` en todo log [MVP]; nunca en definiciones de workflows [MVP]                                        |
| T3  | Inyección vía definiciones de workflow | JSON malicioso, SSRF desde http-generic, prompt injection hacia nodos IA | Validación Zod estricta del schema [MVP]; sin `eval`/plantillas ejecutables [MVP]; allowlist de hosts para http-generic [Post-MVP]; outputs de IA validados contra schema y tratados como datos no confiables [MVP]                 |
| T4  | Escalada de privilegios interna        | Miembro viewer ejecutando/aprobando                                      | Autorización por rol en cada endpoint [MVP]; matriz de permisos del engine (WORKFLOW_ENGINE.md §11) [MVP]; audit de cambios de permisos [MVP]                                                                                       |
| T5  | Compromiso de la cadena de suministro  | Dependencia maliciosa, secreto en repo, CI comprometido                  | Dependabot + pnpm audit + gitleaks [MVP]; lockfile obligatorio [MVP]; sin credenciales cloud estáticas en CI (WIF) [Post-MVP]; branch protection + CODEOWNERS [MVP]                                                                 |
| T6  | Abuso / DoS                            | Ejecuciones masivas, coste IA desbocado                                  | Límites por plan [MVP diseño]; rate limiting por IP y organización [MVP-C9]; budget IA con cap duro [MVP-C8]; timeouts por nodo [MVP-C6]                                                                                            |
| T7  | Workflows maliciosos en marketplace    | Template de tercero que exfiltra datos                                   | Validación automática al publicar; revisión para badge verified; permisos de conectores explícitos al instalar [Post-MVP — bloquea el marketplace público hasta existir]                                                            |

## 2. Autenticación

- **[MVP]** Email + password (hash argon2id), sesión server-side con cookie `httpOnly`, `Secure`, `SameSite=Lax`, firmada con `AUTH_SESSION_SECRET`. Expiración deslizante (7 días) + revocación en logout.
- Sin límite conocido de intentos → **[MVP]** rate limit específico en `/auth/*` + backoff incremental.
- **[Post-MVP]** Auth.js / OIDC, 2FA, SSO/SAML (Enterprise). El módulo identity aísla esto para que el cambio no toque dominios.

## 3. Autorización

- Modelo: rol por organización (`owner > admin > member > viewer`) en `organization_members`. Un usuario puede pertenecer a varias organizaciones con roles distintos.
- **[MVP]** Cada endpoint declara el rol mínimo; el middleware lo comprueba tras resolver `TenantContext`. Sin declaración explícita → denegado por defecto (fail-closed).
- **[Post-MVP]** Permisos finos por recurso (tablas roles/permissions ya diseñadas).

## 4. Aislamiento multi-tenant

Regla de oro: **ningún dato sale de la BD sin pasar por un filtro de `organization_id` derivado de la sesión** (nunca de parámetros del cliente).

1. Middleware resuelve `TenantContext` de la sesión + membresía verificada.
2. Repositorios exigen `TenantContext` como parámetro (imposible llamar sin él por tipos).
3. Servicios re-asertan con `assertSameTenant` (defensa en profundidad).
4. Cross-tenant → `NOT_FOUND` (no filtrar existencia).
5. Jobs: el payload lleva `organizationId`, pero el worker recarga la entidad y contrasta.
6. Queries de sistema (sin tenant): solo en módulos `system-scope`, listados y revisados.
7. **[Post-MVP]** RLS de PostgreSQL como segunda barrera física.

## 5. Gestión de secretos

| Tipo                            | Local                                                                  | GCP futuro                           |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| Config de app (`DATABASE_URL`…) | `.env` (gitignored)                                                    | Secret Manager → env de Cloud Run    |
| Credenciales de conectores      | Tabla cifrada AES-256-GCM (clave en env) referenciada por `secret_ref` | Secret Manager, un secret por cuenta |
| API keys de IA                  | `.env`, opcionales (mock default)                                      | Secret Manager                       |
| CI                              | Ningún secreto cloud estático                                          | WIF/OIDC                             |

Reglas: `.env.example` documenta todo sin valores reales; los secretos nunca aparecen en
definiciones de workflows, contexts de ejecución, logs ni respuestas de API (los steps
persisten input/output **ya sanitizados**).

## 6. Auditoría y logs seguros

- `audit_logs` append-only para: login, cambios de miembros/roles, instalación/edición de workflows, resolución de aprobaciones, conexión/revocación de conectores, cambios de plan. Nunca se borra.
- Logs de aplicación: JSON estructurado vía `@flowhub/observability`; `redact()` enmascara claves tipo secret/token/password/authorization a cualquier profundidad (con test).
- Prohibido loguear: tokens, cuerpos de credenciales, contenidos completos de documentos de cliente, prompts con PII innecesaria.
- Cada línea en contexto de request/job lleva `organizationId` y `requestId`/`executionId` para trazabilidad.

## 7. Protección y minimización de datos

- Residencia UE (GCP `europe-west1`/`europe-southwest1`) — decisión en GCP_DEPLOYMENT.md.
- Cifrado en tránsito (TLS) y en reposo (Cloud SQL/Storage por defecto; local no aplica).
- Minimización: los nodos IA reciben **solo** los campos que su config declara, no el contexto completo de ejecución.
- Retención: logs de ejecución 90 días (extensible como upsell); soft-delete de usuario + job de borrado real (GDPR art. 17) [diseñado, MVP-C9].
- DPA y subprocesadores (providers IA) documentados antes del primer cliente real.

## 8. Acceso a conectores externos y OAuth futuro

- MVP: solo mocks — sin credenciales reales de terceros.
- La interfaz `Connector` ya separa: definición de acción / resolución de credenciales por `connectorAccountId` en runtime / ejecución. Los handlers nunca reciben tokens en claro para loguear (envoltorio que solo expone `authorize(request)`).
- OAuth futuro: authorization code + PKCE, tokens cifrados en el backend de secretos, refresh automático, revocación desde la UI, scopes mínimos por acción.
- `http-generic`: allowlist de hosts por organización + bloqueo de IPs privadas/metadata endpoints (anti-SSRF) antes de permitir uso real.

## 9. Seguridad de la API

- **[MVP-C3/C5]** Headers: HSTS, X-Content-Type-Options, X-Frame-Options DENY, CSP en web.
- CORS: allowlist explícita desde `CORS_ALLOWED_ORIGINS` — nunca `*` con credenciales.
- Rate limiting básico por IP (global) y por organización (ejecuciones) [C9].
- Validación Zod de input **y output** (el output filtra campos no declarados — anti data leak).
- Errores al cliente: código estable + mensaje genérico; detalle solo en logs de servidor.

## 10. Política de permisos internos (equipo)

- `main` protegida: PR + review de CODEOWNER + checks verdes obligatorios (ADR-0009 y `infra/github/BRANCH_PROTECTION.md`).
- Cambios en `docs/security/`, `infra/`, `.github/` requieren revisión del owner.
- Acceso a producción (cuando exista): mínimo privilegio, sin acceso directo a BD de producción salvo break-glass documentado y auditado.

## 11. Backups y recuperación

- Local: script de dump manual (Ciclo 4).
- GCP: Cloud SQL automated backups diarios + PITR 7 días; prueba de restore documentada antes del primer cliente. Objetivo inicial RPO ≤ 24h, RTO ≤ 4h (revisar con clientes Enterprise).
