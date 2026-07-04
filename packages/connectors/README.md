# @flowhub/connectors

Contrato `Connector` y registro de conectores. El MVP usa solo mocks (gmail-mock, slack-mock, drive-mock, http-generic, webhook-inbound) — Ciclo 6.

La interfaz ya contempla `auth: 'oauth2'` para conectores reales post-MVP: las credenciales se resuelven por `connectorAccountId` en runtime y nunca viven en definiciones de workflows ni logs.
