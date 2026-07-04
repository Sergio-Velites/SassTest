# @flowhub/jobs

Abstracción `JobQueue` (ADR-0005): `enqueue` / `schedule` / `process` / `ready` / `close`.
Es lo único que api y worker conocen de la cola.

Implementaciones:

- **`BullMqJobQueue`** — Redis/BullMQ, usando solo el subconjunto portable (add con delay, dedup por jobId, worker) para que una implementación futura con Cloud Tasks sea 1:1.
- **`InMemoryJobQueue`** — para tests y ejecuciones locales efímeras (sin durabilidad), con captura de fallos de handler para aserciones.

Reglas: los payloads se validan con Zod al encolar; llevan `organizationId` pero el consumidor **siempre** recarga la entidad de BD y re-asserta el tenant (SECURITY_MODEL.md §4). La implementación BullMQ no se testea en CI (requiere Redis); se cubre con smoke test local (`pnpm db:up` + arrancar el worker).
