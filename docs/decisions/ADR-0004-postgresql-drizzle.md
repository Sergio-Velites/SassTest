# ADR-0004: PostgreSQL + Drizzle ORM

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

Base de datos relacional multi-tenant, con jsonb para definiciones de workflows,
migraciones versionadas y camino directo a Cloud SQL. ORM candidato: Prisma o Drizzle.

## Decisión

**PostgreSQL 16** como única base de datos transaccional y **Drizzle ORM** como capa de acceso.
Migraciones SQL generadas con drizzle-kit, revisadas a mano y versionadas en el repo.

## Alternativas consideradas

- **Prisma** — excelente DX, pero: motor de query propio (histórico binario/WASM) con más peso en cold start, schema DSL propio en lugar de SQL, y menos control fino sobre índices parciales/CHECKs que este modelo de datos usa bastante. La distancia con Drizzle en DX se ha cerrado; la distancia en control no.
- **Kysely (query builder puro)** — máximo control, pero sin generación de migraciones desde schema; más trabajo manual sin beneficio claro frente a Drizzle.
- **MySQL** — sin ventaja alguna aquí; jsonb, citext y RLS futuros favorecen a Postgres.

## Consecuencias

- (+) SQL visible y auditable (crítico para revisar filtros de tenant); tipos TS inferidos del schema; cold start mínimo en Cloud Run; RLS de Postgres disponible como capa futura.
- (−) Drizzle es más joven que Prisma; algunas features (relaciones profundas) requieren SQL más explícito — aceptable, preferimos lo explícito.
- El modelo objetivo completo está en `docs/architecture/DATA_MODEL.md`; se implementa en el Ciclo 4.
