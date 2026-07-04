# Workflow Engine — Especificación

**Última actualización:** 2026-07-04. Los tipos ejecutables viven en
`packages/workflow-engine/src/` — **mantener ambos en sync**. El executor se
implementa en el Ciclo 6 siguiendo este documento.

## 1. Conceptos

| Concepto                | Definición                                                                                                         | Persistencia                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **Workflow template**   | Proceso empaquetado y publicable (catálogo/marketplace), con versiones inmutables                                  | `workflow_templates` + `workflow_template_versions`    |
| **Installed workflow**  | Copia de una versión de template dentro de una organización, con su configuración (variables, cuentas de conector) | `installed_workflows` + `workflow_versions`            |
| **Workflow definition** | JSON validado por `workflowDefinitionSchema`: nodos + edges + variables                                            | columna `definition` (jsonb) de la versión             |
| **Nodo**                | Unidad de trabajo del grafo. Kinds: `trigger`, `action`, `condition`, `ai`, `approval`, `wait`, `transform`        | `workflow_nodes` (desnormalizado para queries) + jsonb |
| **Edge**                | Arista dirigida `from → to`, con `branch` opcional para salidas de `condition`/`approval`                          | `workflow_edges` + jsonb                               |
| **Ejecución**           | Una pasada de un installed workflow por el grafo, con contexto de datos propio                                     | `workflow_executions`                                  |
| **Step**                | La ejecución de un nodo concreto dentro de una ejecución (un registro por intento agregado)                        | `workflow_execution_steps`                             |

## 2. Estados

### Ejecución (`workflow_executions.status`)

```
pending ──▶ running ──▶ succeeded
               │ ▲
               │ └── waiting / waiting_approval (pausas, reanudan a running)
               ├──▶ failed      (error no recuperable o reintentos agotados)
               └──▶ cancelled   (usuario u operador)
```

Reglas:

- `pending → running` solo la hace el worker al tomar el job (lock por ejecución).
- `waiting`: pausada por nodo `wait`; reanuda por timer (job retrasado).
- `waiting_approval`: pausada por nodo `approval`; reanuda cuando la approval request se resuelve.
- `cancelled` es terminal; una ejecución cancelada no reanuda aunque llegue la aprobación.

### Step (`workflow_execution_steps.status`)

`pending → running → succeeded | failed | skipped`

`skipped`: el nodo está en una rama no tomada por una condición.

## 3. Modelo de ejecución

1. El worker carga la definición (jsonb) y la valida con el schema (una definición persistida inválida es un bug: se marca `failed` con `EXECUTION_ERROR`).
2. Ejecuta desde el nodo `trigger` (exactamente uno por definición) siguiendo edges.
3. **Contexto de datos** (`ExecutionContextData`): bag JSON; el output de cada nodo se guarda bajo su `node.id`. Los nodos leen outputs anteriores por referencia (`{{nodes.classify.isInvoice}}` en configs — interpolación resuelta por el engine).
4. En nodos `condition`, el handler devuelve `branch` (`'true'`/`'false'` u otra etiqueta); el engine sigue el edge cuya `branch` coincida. Sin edge coincidente → `failed` (grafo mal construido; el builder debe validarlo antes).
5. El contexto se persiste como snapshot en la ejecución tras cada step, para poder reanudar pausas y reintentos sin re-ejecutar nodos completados.
6. MVP: ejecución **secuencial** (sin paralelismo de ramas). El fan-out paralelo es post-MVP y requerirá joins explícitos.

## 4. Errores y reintentos

- Los handlers devuelven `{status:'failed', error, retryable}` — nunca lanzan para fallos esperados.
- `retryable: true` (timeouts, 5xx de conectores, rate limits): el engine reintenta con backoff exponencial (5s, 25s, 125s), **máx. 3 intentos** por defecto (configurable por nodo en `config.retries`).
- `retryable: false` (validación, 4xx, config inválida): la ejecución pasa a `failed` inmediatamente.
- Errores no controlados (excepciones) se capturan, se loguean con stack y marcan step+ejecución `failed` con `INTERNAL_ERROR`. No se reintentan automáticamente (podrían no ser idempotentes).
- Cada intento queda registrado en los logs del step (`attempt` en cada línea).

## 5. Idempotencia

- Clave de idempotencia de step: `(execution_id, node_id)`; el `attempt` distingue reintentos.
- El engine nunca re-ejecuta un step `succeeded` (los snapshots de contexto lo garantizan tras crash/reanudación).
- Los handlers deben ser idempotentes **por intento**: los conectores reales recibirán la clave de idempotencia para deduplicar efectos externos (los mocks la ignoran).
- El job de ejecución es re-entregable: si el worker muere a mitad, otro worker retoma desde el último step completado.

## 6. Aprobaciones humanas

1. El nodo `approval` crea `approval_requests` (título, descripción, payload a revisar, `approver_role` mínimo, opcional `assignee_user_id`) y devuelve `waiting_approval`.
2. La ejecución queda en `waiting_approval`; nada corre mientras tanto.
3. Un usuario con permiso resuelve vía API: `approved` | `rejected` (+ comentario). Queda en `audit_logs`.
4. La resolución re-encola la ejecución; el engine continúa por el edge `branch='approved'` o `branch='rejected'`.
5. Timeout opcional (`config.expiresInHours`): al vencer, la request pasa a `expired` y el engine sigue por `branch='expired'` si existe; si no, la ejecución `failed`.

## 7. Webhooks

- **Inbound (post-MVP)**: cada installed workflow con trigger webhook obtiene una URL única `/hooks/:installedWorkflowId/:token`; verificación por token secreto + firma HMAC cuando el emisor la soporte; el payload entra como input del trigger. El MVP solo trae trigger manual, pero el connector `webhook-inbound` ya define la interfaz.
- **Outbound**: son acciones del connector `http-generic` (con allowlist de hosts por organización, post-MVP).

## 8. Jobs asíncronos

- Interfaz `JobQueue` (Ciclo 3): `enqueue(type, payload, opts)`, `schedule(type, payload, runAt)`, `process(type, handler)`.
- Implementación local: BullMQ + Redis. Futuro: Pub/Sub o Cloud Tasks (ADR-0005).
- Tipos de job del MVP: `execution.run` (ejecutar/reanudar), `execution.resume-wait` (timer de wait), `approval.expire` (timeout de aprobación).
- Los payloads de job llevan `organizationId` y se re-valida el tenant al consumir (nunca confiar solo en el payload: se recarga la ejecución de BD y se contrasta).

## 9. Versionado de workflows

- Las versiones de template (`workflow_template_versions`) son **inmutables** una vez publicadas; editar = nueva versión (semver: MAJOR cambia contrato de variables/conectores, MINOR añade nodos, PATCH corrige configs).
- Instalar copia la definición → la instalación no cambia si el template evoluciona.
- Cada instalación puede tener sus propias versiones locales (`workflow_versions`) si el cliente edita su copia.
- Una ejecución referencia la versión exacta con la que corrió — los históricos siempre son interpretables.
- Upgrade de instalaciones a nueva versión del template: post-MVP (requiere diff de variables y migración asistida).

## 10. Marketplace (diseño; implementación post-MVP)

- `marketplace_listings` referencia un template + versión publicada, con precio (0 = gratis), categoría, rating.
- Estados del template: `draft → private → published → deprecated`.
- Publicar exige validación automática (schema, sin secretos embebidos, nodos permitidos) + revisión para el badge `verified`.
- La instalación desde marketplace usa el mismo flujo que el catálogo interno.

## 11. Permisos sobre el motor

| Acción                               | Rol mínimo (organización)                                       |
| ------------------------------------ | --------------------------------------------------------------- |
| Ver catálogo, ejecuciones y logs     | `viewer`                                                        |
| Ejecutar workflow manualmente        | `member`                                                        |
| Instalar/configurar/editar workflows | `admin`                                                         |
| Resolver aprobaciones                | `member` con `approver_role` requerido por el nodo (o assignee) |
| Conectar cuentas de conectores       | `admin`                                                         |
| Publicar en marketplace              | `owner` (+ cuenta de creator verificada)                        |

Toda acción de esta tabla escribe en `audit_logs`.
