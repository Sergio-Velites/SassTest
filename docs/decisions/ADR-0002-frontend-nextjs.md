# ADR-0002: Frontend con Next.js App Router

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

Necesitamos un dashboard B2B con auth por sesión, catálogo, detalle de ejecuciones y,
post-MVP, un editor visual de workflows (React Flow). Debe desplegar bien en Cloud Run.

## Decisión

**Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query + Zod +
Zustand** (estado local ligero). **React Flow** para el editor visual post-MVP.
Output `standalone` para contenedor en Cloud Run.

## Alternativas consideradas

- **Vite + React SPA** — más simple, pero perdemos SSR (primera carga del dashboard), routing con auth server-side y el ecosistema de despliegue contenedorizado maduro.
- **Remix** — válido, pero menor solape con shadcn/ui y menos conocimiento acumulado; no aporta nada decisivo aquí.

## Consecuencias

- (+) Stack estándar: cualquier desarrollador React es productivo el día 1; shadcn/ui acelera un UI B2B decente.
- (−) App Router impone disciplina server/client components; la app es el paquete más pesado del monorepo.
- El frontend consume la API REST tipada (schemas Zod compartidos vía `@flowhub/shared`), no server actions contra la BD — la API es la única frontera con los datos.
