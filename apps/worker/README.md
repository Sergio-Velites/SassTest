# @flowhub/worker

Worker de ejecución asíncrona. **Estado: placeholder** — Ciclo 6 implementa el consumidor BullMQ que ejecuta workflows vía `@flowhub/workflow-engine`.

La cola se usa solo a través de la abstracción `JobQueue` (ADR-0005) para poder migrar a Pub/Sub o Cloud Tasks sin tocar lógica de negocio.
