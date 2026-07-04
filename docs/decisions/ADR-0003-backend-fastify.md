# ADR-0003: Backend con Fastify + Zod

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

La propuesta inicial era NestJS o Fastify. Requisitos: API REST, OpenAPI desde el inicio,
validación Zod, arquitectura modular por dominios, buen arranque en frío para Cloud Run.

## Decisión

**Fastify** con **fastify-type-provider-zod** (schemas Zod = validación runtime + tipos
estáticos + OpenAPI generado desde el mismo schema) y `@fastify/swagger`. Estructura modular
por dominios mediante plugins de Fastify (`src/modules/<dominio>/`): la modularidad la da
la organización del código, no un framework.

REST primero; si GraphQL tuviese sentido más adelante (clientes con necesidades de query
flexibles), se añadiría como capa aparte (Mercurius/Yoga) sin tocar los servicios de dominio —
la lógica vive en servicios, no en handlers HTTP.

## Alternativas consideradas

- **NestJS** — modularidad y DI de serie, pero: decoradores + metadata mágica, validación class-validator ajena a Zod (o adaptadores), arranque más pesado, y una curva/ceremonia que no compensa para un equipo pequeño con IA generando código consistente.
- **Express** — ecosistema enorme pero sin tipado de schemas de serie y peor rendimiento; Fastify es su sucesor natural.

## Consecuencias

- (+) Un solo lenguaje de validación (Zod) en front, API y engine; OpenAPI sin duplicar contratos; cold start pequeño.
- (−) La disciplina modular es nuestra responsabilidad (convención documentada en CLAUDE.md), no del framework.
- Señal de revisión: si la inyección de dependencias manual se vuelve inmanejable (>10 dominios entrelazados), considerar un contenedor DI ligero (awilix), no una migración a Nest.
