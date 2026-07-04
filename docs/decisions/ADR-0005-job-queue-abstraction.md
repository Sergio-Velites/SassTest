# ADR-0005: Cola de jobs — BullMQ tras interfaz intercambiable

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

El motor de workflows es asíncrono: ejecutar, reanudar tras waits/aprobaciones, timers,
reintentos. En local queremos algo simple; en GCP los servicios naturales son Pub/Sub,
Cloud Tasks o Cloud Run Jobs. No queremos reescribir lógica de negocio al migrar.

## Decisión

Definir una interfaz interna **`JobQueue`** (`enqueue`, `schedule`, `process`) que es lo único
que api y worker conocen. Primera implementación: **BullMQ + Redis** (docker-compose en local,
Memorystore si se despliega tal cual). La lógica de ejecución NO usa features exclusivas de
BullMQ (flows, repeatables complejos) para mantener la portabilidad real.

Destino previsto en GCP: **Cloud Tasks** para jobs con delay (waits, expiración de aprobaciones)
y push a endpoints del worker — encaja mejor con Cloud Run que un consumidor bloqueante.

## Alternativas consideradas

- **pg-boss (cola sobre Postgres)** — una pieza menos de infra; descartado por menor throughput y por acoplar la carga de la cola a la BD transaccional, pero es la alternativa a reconsiderar si Redis molesta operativamente.
- **Pub/Sub directo desde el inicio** — no funciona en local sin emulador y complica el MVP.
- **Sin cola (ejecución in-process en la API)** — inaceptable: pierde reintentos, pausas y aislamiento de recursos desde el día 1, y la frontera api/worker es la misma que tendremos en cloud.

## Consecuencias

- (+) Local trivial; swap de backend = nueva implementación de una interfaz pequeña.
- (−) Redis es una pieza más de infraestructura; disciplina de "mínimo común" sobre BullMQ.
- Los payloads de job llevan `organizationId` pero el consumidor re-valida el tenant contra BD (ver SECURITY_MODEL.md §4).
