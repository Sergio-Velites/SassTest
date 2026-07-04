# Invoice Intake Demo

Workflow de demostración del MVP: recepción y registro de facturas con clasificación IA,
extracción de datos y aprobación humana por umbral de importe. Todos los conectores e IA
en **modo mock**.

## Grafo

```
trigger(manual)
  → receive-email (action: gmail-mock)
  → classify (ai: ¿es factura?)
  → is-invoice? (condition)
        ├─ false → notify-not-invoice (action: slack-mock) → FIN
        └─ true  → extract (ai: proveedor, importe, fecha, IVA)
                   → amount-check (condition: importe < 500)
                         ├─ true  → register (action: accounting-mock)
                         └─ false → approval (humana)
                                       ├─ approved → register
                                       └─ rejected → notify-rejected (action: slack-mock) → FIN
register → notify-registered (action: slack-mock) → FIN
```

## Definición JSON

```json
{
  "name": "Invoice Intake Demo",
  "description": "Recibe un email con PDF, clasifica con IA, extrae datos, aprueba por umbral y registra en contabilidad (todo mock).",
  "variables": {
    "approvalThresholdEur": "500"
  },
  "nodes": [
    { "id": "start", "kind": "trigger", "name": "Manual trigger", "config": { "type": "manual" } },
    {
      "id": "receive-email",
      "kind": "action",
      "name": "Receive email with PDF",
      "config": { "connector": "gmail-mock", "action": "fetch_email_with_attachment" }
    },
    {
      "id": "classify",
      "kind": "ai",
      "name": "Classify: is it an invoice?",
      "config": {
        "promptTemplate": "invoice-classify@1",
        "input": { "document": "{{nodes.receive-email.attachmentText}}" }
      }
    },
    {
      "id": "is-invoice",
      "kind": "condition",
      "name": "Is invoice?",
      "config": { "expression": "{{nodes.classify.isInvoice}} == true" }
    },
    {
      "id": "notify-not-invoice",
      "kind": "action",
      "name": "Notify: not an invoice",
      "config": {
        "connector": "slack-mock",
        "action": "send_message",
        "params": { "channel": "#finance", "text": "Documento recibido no es una factura." }
      }
    },
    {
      "id": "extract",
      "kind": "ai",
      "name": "Extract invoice fields",
      "config": {
        "promptTemplate": "invoice-extract@1",
        "input": { "document": "{{nodes.receive-email.attachmentText}}" }
      }
    },
    {
      "id": "amount-check",
      "kind": "condition",
      "name": "Amount < threshold?",
      "config": {
        "expression": "{{nodes.extract.totalAmount}} < {{variables.approvalThresholdEur}}"
      }
    },
    {
      "id": "approval",
      "kind": "approval",
      "name": "Finance approval",
      "config": {
        "title": "Aprobar factura de {{nodes.extract.vendor}}",
        "requiredRole": "member",
        "expiresInHours": 72,
        "payloadFrom": "extract"
      }
    },
    {
      "id": "register",
      "kind": "action",
      "name": "Register in accounting",
      "config": {
        "connector": "accounting-mock",
        "action": "create_entry",
        "params": { "from": "extract" }
      }
    },
    {
      "id": "notify-rejected",
      "kind": "action",
      "name": "Notify rejection",
      "config": {
        "connector": "slack-mock",
        "action": "send_message",
        "params": { "channel": "#finance", "text": "Factura rechazada en aprobación." }
      }
    },
    {
      "id": "notify-registered",
      "kind": "action",
      "name": "Notify registered",
      "config": {
        "connector": "slack-mock",
        "action": "send_message",
        "params": { "channel": "#finance", "text": "Factura registrada correctamente." }
      }
    }
  ],
  "edges": [
    { "from": "start", "to": "receive-email" },
    { "from": "receive-email", "to": "classify" },
    { "from": "classify", "to": "is-invoice" },
    { "from": "is-invoice", "to": "extract", "branch": "true" },
    { "from": "is-invoice", "to": "notify-not-invoice", "branch": "false" },
    { "from": "extract", "to": "amount-check" },
    { "from": "amount-check", "to": "register", "branch": "true" },
    { "from": "amount-check", "to": "approval", "branch": "false" },
    { "from": "approval", "to": "register", "branch": "approved" },
    { "from": "approval", "to": "notify-rejected", "branch": "rejected" },
    { "from": "register", "to": "notify-registered" }
  ]
}
```

Notas:

- `accounting-mock` es un conector mock adicional a los cinco base (trivial: registra y devuelve un id).
- Los prompts `invoice-classify@1` e `invoice-extract@1` se siembran en `ai_prompt_templates` con output schema (`{isInvoice: boolean, confidence: number}` y `{vendor, totalAmount, date, vatAmount}`).
- El `MockAiProvider` se siembra con respuestas canned para ambos prompts, de modo que la demo es determinista.

## Criterios de prueba (Ciclo 6)

1. Ejecución con importe mock 350€ → termina `succeeded` sin aprobación; entrada contable y notificación registradas.
2. Ejecución con importe mock 1.200€ → queda `waiting_approval`; aprobar → `succeeded`; rechazar → `succeeded` por la rama de rechazo con notificación.
3. Documento mock no-factura → rama `false` de `is-invoice`, termina `succeeded`.
4. Todos los steps y logs visibles en el historial; ninguna traza contiene secretos.
