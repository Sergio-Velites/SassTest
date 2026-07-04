# @flowhub/api

Backend API de FlowHub AI. **Estado: placeholder** — Ciclo 3 scaffolda Fastify + Zod + OpenAPI; Ciclo 5 añade los dominios (auth, organizations, workflows, executions, logs).

Reglas clave: cada endpoint valida input/output con Zod, exige `TenantContext` y aplica autorización por organización. Ver `docs/security/SECURITY_MODEL.md`.
