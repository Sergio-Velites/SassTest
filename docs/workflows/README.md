# Workflows — especificaciones

Especificaciones de workflows first-party (los que sembramos como plantillas del catálogo).
Cada workflow tiene su fichero con: objetivo, grafo, JSON de definición y criterios de prueba.

| Workflow                                      | Estado                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| [Invoice Intake Demo](invoice-intake-demo.md) | Especificado — se implementa como seed en Ciclos 4–6 |

El JSON de cada definición debe validar contra `workflowDefinitionSchema`
(`packages/workflow-engine/src/definition.ts`).
