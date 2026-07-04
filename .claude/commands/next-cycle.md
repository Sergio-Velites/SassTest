---
description: Implementa el siguiente ciclo pendiente del backlog de FlowHub AI de forma autónoma
---

Eres el ingeniero responsable de continuar FlowHub AI de forma autónoma. Ejecuta UNA iteración de trabajo siguiendo exactamente este protocolo:

## 1. Orientación (obligatorio antes de tocar nada)

1. Lee `CLAUDE.md` completo (estado actual §2, convenciones §5, reglas de seguridad §9, qué NO hacer §10, fases §12).
2. Lee `docs/product/BACKLOG.md` y localiza el **primer ciclo con tareas pendientes** (⬜ / checkboxes sin marcar).
3. Ejecuta `git log --oneline -5` y `git status` para ver dónde quedó la sesión anterior. Si hay trabajo a medias sin commitear, termínalo o descártalo conscientemente antes de empezar nada nuevo.

## 2. Trabajo

4. Del ciclo activo, elige el **bloque de tareas más pequeño que deje el proyecto funcionando** (no hace falta completar el ciclo entero en una iteración; sí hace falta no dejarlo roto).
5. Implementa siguiendo las especificaciones: `docs/architecture/DATA_MODEL.md` para BD, `docs/architecture/WORKFLOW_ENGINE.md` para el engine, `docs/security/SECURITY_MODEL.md` para todo. Ante ambigüedad, elige la opción más profesional para un SaaS B2B, documenta la decisión (ADR si es de arquitectura) y sigue — no preguntes.
6. Escribe tests de lo que implementes. Respeta: TS estricto sin `any`, Zod en los bordes, `organization_id` en toda query tenant-owned, logs solo vía observability, nada de secretos.

## 3. Cierre (obligatorio en cada iteración)

7. `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build` — todo en verde. Si algo falla, arréglalo antes de continuar.
8. Actualiza `docs/product/BACKLOG.md` (marca checkboxes completados) y `CLAUDE.md` §2/§12 si cambió el estado del proyecto. Actualiza README/docs afectadas.
9. Commit con Conventional Commits y push a la rama de trabajo actual (`git push -u origin <rama-actual>`; ante fallo de red reintenta con backoff 2s/4s/8s/16s).
10. Termina tu respuesta con un bloque de estado:
    - **Hecho en esta iteración:** …
    - **Ciclo activo:** N (X de Y tareas)
    - **Siguiente paso:** …

## Condición de parada

- Si TODOS los ciclos 3–9 del backlog están completos (los items "Post-MVP" NO cuentan: requieren decisión del usuario), responde exactamente `BACKLOG COMPLETO — no queda trabajo autónomo` con un resumen final, **no hagas ningún cambio** y, si estás corriendo dentro de /loop, finaliza el bucle no programando más iteraciones.
- Si estás bloqueado por algo que solo el usuario puede decidir (credenciales, decisión de producto), documenta el bloqueo en el bloque de estado, sáltate esa tarea y continúa con la siguiente no bloqueada. Solo detén el bucle si TODO lo restante está bloqueado.
