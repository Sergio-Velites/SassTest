# PRD — FlowHub AI

**Versión:** 0.1 · **Estado:** draft aprobado para MVP · **Última actualización:** 2026-07-04

## 1. Problema

Las empresas usan decenas de herramientas (Gmail, Outlook, Slack, Teams, Drive, Notion,
HubSpot, Salesforce, Shopify, Stripe, QuickBooks, Holded, Xero, Pipedrive…), pero sus
**procesos reales** siguen dependiendo de copiar/pegar, Excel, cadenas de email,
aprobaciones manuales y conocimiento en la cabeza de personas concretas.

Las herramientas de automatización existentes (Zapier, Make, n8n) resuelven
**automatizaciones sueltas** ("cuando pase X, haz Y"), no **procesos completos** con
estados, aprobaciones humanas, razonamiento y auditoría. Montar un proceso de verdad
en ellas exige un experto interno y el resultado es frágil y opaco.

## 2. Propuesta de valor

**FlowHub AI: instala procesos, no automatizaciones.**

1. **Workflows instalables**: procesos completos y listos para usar desde un marketplace (gestión de facturas, onboarding de empleados, aprobación de gastos, recuperación de clientes, revisión de contratos…).
2. **IA nativa en el proceso**: nodos que clasifican, extraen datos, redactan, deciden o proponen acciones — con trazas y coste visibles.
3. **Humanos en el bucle**: aprobaciones cuando hay riesgo (importes altos, datos sensibles, decisiones irreversibles).
4. **Auditoría y ROI**: todo queda registrado; el cliente ve tiempo ahorrado, tareas ejecutadas y errores evitados.
5. **Ecosistema**: terceros publican workflows (gratuitos o de pago) y la plataforma cobra comisión.

## 3. Público objetivo

- **Primario**: pymes y mid-market (10–500 empleados) sin equipo técnico dedicado a automatización, en operaciones/finanzas/RRHH/ventas.
- **Secundario**: consultoras y agencias que implantan procesos para clientes (futuros creadores del marketplace).
- **Geografía inicial**: España/UE (implica GDPR y residencia de datos UE desde el diseño).

## 4. Personas

| Persona                             | Rol                            | Necesidad                                                         |
| ----------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| **Operations Manager** (compradora) | Dirige operaciones en una pyme | Quitar trabajo manual repetitivo sin proyecto de IT               |
| **Finance Lead**                    | Responsable de facturas/gastos | Control y trazabilidad; aprobar solo lo que importa               |
| **Admin interno**                   | El "que sabe de herramientas"  | Instalar/configurar workflows y conectar cuentas sin programar    |
| **Creator/Consultor**               | Consultora de procesos         | Empaquetar su know-how como workflows vendibles                   |
| **Empleado**                        | Usuario final                  | Recibir tareas/aprobaciones claras en las herramientas que ya usa |

## 5. Casos de uso (priorizados)

1. **Invoice Intake** (demo del MVP): email con factura → IA clasifica y extrae datos → aprobación si importe > umbral → registro contable → notificación.
2. Onboarding de empleados: alta → cuentas, accesos, documentación, checklist con responsables.
3. Aprobación de gastos: recibo → extracción → política → aprobación → export contable.
4. Recuperación de clientes: detección de inactividad → IA redacta outreach → revisión humana → envío → seguimiento.
5. Gestión de contratos: recepción → IA extrae cláusulas clave → revisión → firma → archivo con recordatorio de renovación.
6. Soporte interno: solicitud → clasificación IA → enrutado → resolución o escalado → base de conocimiento.

## 6. MVP (alcance comprometido)

El MVP permite, de punta a punta y en local:

1. Crear cuenta y organización.
2. Ver dashboard con actividad.
3. Explorar el catálogo de workflows y ver su detalle.
4. Instalar el workflow de ejemplo (Invoice Intake Demo).
5. Ejecutarlo manualmente con nodos mock (conectores + IA en modo mock).
6. Ver historial de ejecuciones, pasos, estados y logs completos.
7. Crear un workflow simple desde JSON (validado por el schema del engine).
8. Aprobar/rechazar una approval request generada por el flujo.
9. Tests básicos y documentación clara.

## 7. Fuera de alcance del MVP

- OAuth real con herramientas externas (las interfaces lo contemplan; la implementación no).
- Cobro real (Stripe) — solo entidades de billing.
- Editor visual drag&drop completo (React Flow llega tras el MVP; el MVP crea workflows por JSON).
- Marketplace público con pagos a terceros (el catálogo interno hace de precursor).
- SSO/SAML, SCIM, auditoría exportable — características Enterprise post-MVP.
- BigQuery/analítica avanzada — el event log en PostgreSQL cubre el MVP.
- Apps móviles.

## 8. Métricas

**De producto (north star: horas de trabajo manual eliminadas/semana):**

- Ejecuciones de workflows completadas / semana / organización.
- Ratio de ejecuciones con éxito (objetivo > 95%).
- Time-to-first-execution desde el registro (objetivo < 15 min).
- Nº de workflows instalados por organización (objetivo ≥ 3 en 30 días).
- Retención a 4 semanas de organizaciones activas.

**De negocio:**

- MRR, conversión free→paid, churn mensual, NRR.
- Take rate del marketplace (objetivo 20–30% de comisión).
- Margen sobre coste de IA (coste IA < 20% del ingreso del plan).

## 9. Modelo de negocio

### 9.1 Suscripción SaaS (orientativo)

| Plan                 | Precio orientativo | Incluye                                                                                    |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| **Free / Developer** | 0 €                | 1 usuario, 2 workflows instalados, 50 ejecuciones/mes, IA limitada, comunidad              |
| **Starter**          | ~29 €/mes          | 5 usuarios, 10 workflows, 1.000 ejecuciones/mes, conectores estándar                       |
| **Pro**              | ~99 €/mes          | 20 usuarios, workflows avanzados, 10.000 ejecuciones/mes, prioridad IA                     |
| **Business**         | ~299 €/mes         | Equipos, roles/permisos finos, auditoría completa, conectores premium, retención extendida |
| **Enterprise**       | Custom             | SSO/SAML, SLA, soporte dedicado, despliegue dedicado, cumplimiento avanzado, DPA a medida  |

### 9.2 Marketplace

- Terceros publican workflows **gratuitos o de pago** (pago único o suscripción).
- Comisión de plataforma: **20–30%** por venta.
- Rating y reviews; versionado semántico de workflows publicados.
- **Certificación "verified"**: revisión de seguridad/calidad por la plataforma (de pago o por reputación).

### 9.3 Usage-based (sobre los límites del plan)

- Packs de ejecuciones adicionales.
- Llamadas IA (con margen sobre coste de provider; presupuestos y alertas por organización).
- Volumen de documentos procesados (OCR/extracción).
- Conectores premium.
- Retención extendida de logs y analítica avanzada.

### 9.4 Servicios profesionales

Setup inicial, workflows a medida, migraciones e integraciones especiales — directamente
o a través de partners del marketplace (que es también el canal de captación de partners).

## 10. Diferenciación

| Frente a                        | Diferencia                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Zapier/Make                     | Procesos completos con estados, aprobaciones y auditoría, no cadenas de triggers; IA como ciudadano de primera clase con trazas y coste |
| n8n                             | SaaS orientado a negocio (no a técnicos), marketplace de procesos con monetización para creadores                                       |
| BPM tradicional (Camunda…)      | Time-to-value en minutos, sin consultoría obligatoria; instalable como una app                                                          |
| Vertical SaaS (facturas, RRHH…) | Una sola plataforma horizontal + marketplace: el cliente no compra 6 herramientas                                                       |

## 11. Riesgos

| Riesgo                                                | Prob. | Impacto | Mitigación                                                                                          |
| ----------------------------------------------------- | ----- | ------- | --------------------------------------------------------------------------------------------------- |
| Los workflows genéricos no encajan en procesos reales | Alta  | Alto    | Variables/configuración por instalación; servicios profesionales; empezar con 1 vertical (finanzas) |
| Coste de IA descontrolado                             | Media | Alto    | Cost tracking por llamada, budgets por organización, caps duros, mock por defecto                   |
| Fuga de datos cross-tenant                            | Baja  | Crítico | Multi-tenancy en diseño, guards en cada capa, tests de aislamiento, auditoría                       |
| Chicken-and-egg del marketplace                       | Alta  | Medio   | Workflows first-party de calidad primero; partners consultores como primeros creadores              |
| Dependencia de un provider de IA                      | Media | Medio   | AI Gateway con providers intercambiables desde el día 1                                             |
| Competidores con distribución (Zapier, HubSpot)       | Media | Alto    | Foco en procesos con aprobación/auditoría (compliance) que ellos no cubren                          |

## 12. Decisiones abiertas

- Nombre y dominio definitivos (FlowHub AI es provisional).
- Precio definitivo de planes (validar con 10 entrevistas de cliente).
- Primer vertical de lanzamiento (propuesta: finanzas — invoice intake + gastos).
- Política de revenue share exacta del marketplace.
