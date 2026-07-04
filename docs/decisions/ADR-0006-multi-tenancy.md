# ADR-0006: Multi-tenancy — shared schema con organization_id

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

SaaS B2B multi-tenant desde el día 1. Opciones clásicas: BD por tenant, schema por tenant,
o schema compartido con columna discriminadora.

## Decisión

**Schema compartido**: toda tabla de negocio lleva `organization_id NOT NULL` y todos los
accesos pasan por un `TenantContext` resuelto de la sesión. Enforcement en aplicación con
defensa en profundidad (repositorios filtran + servicios re-asertan + cross-tenant responde
NOT_FOUND). **Row-Level Security de PostgreSQL** queda diseñada como segunda capa post-MVP.

## Alternativas consideradas

- **BD por tenant** — aislamiento máximo pero coste operativo (migraciones × N, conexiones, provisioning) prohibitivo para self-service con tenants pequeños. Se reserva como opción de despliegue dedicado Enterprise.
- **Schema de Postgres por tenant** — punto medio que hereda casi todo el coste de migraciones × N; el ecosistema de tooling lo soporta mal.
- **RLS desde el día 1** — deseable, pero exige gestionar `SET app.current_org` en el pool de conexiones y complica los tests iniciales; se añade cuando la base funcione (backlog post-MVP), no se descarta.

## Consecuencias

- (+) Operación y migraciones simples; onboarding de tenant = un INSERT; agregación de métricas de plataforma directa.
- (−) El aislamiento depende de disciplina de código → mitigado con guards tipados (`TenantContext` obligatorio por firma), suite de tests de aislamiento (Ciclo 9) y revisión obligatoria de queries en PRs.
- Señal de revisión: primer cliente Enterprise que exija aislamiento físico → oferta de despliegue dedicado, no cambio del modelo base.
