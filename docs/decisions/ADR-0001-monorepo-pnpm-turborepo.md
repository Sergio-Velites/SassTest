# ADR-0001: Monorepo con pnpm workspaces + Turborepo

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

web, api y worker comparten tipos de dominio (workflow definitions, TenantContext, errores)
y deben evolucionar juntos. Publicar paquetes internos a un registry sería fricción pura.

## Decisión

Monorepo con **pnpm workspaces** (gestión de dependencias, `workspace:*`) y **Turborepo**
(orquestación de tareas con caché y grafo de dependencias). Paquetes bajo `@flowhub/*`.

## Alternativas consideradas

- **Nx** — más potente (generators, plugins) pero más opinionado y con más superficie de aprendizaje; su valor aparece con decenas de proyectos, no con 11 paquetes.
- **pnpm workspaces solo** — sin caché ni orden topológico de tareas; Turborepo lo da con un fichero de config.
- **Multi-repo** — versionado cruzado de tipos compartidos insostenible para un equipo pequeño.

## Consecuencias

- (+) Tipos end-to-end sin publicar; un solo CI; refactors atómicos.
- (−) Turbo añade una capa de config (`turbo.json`); builds de Next.js requieren outputs declarados.
- Revisar si el repo supera ~30 paquetes o entra un segundo equipo (evaluar Nx entonces).
