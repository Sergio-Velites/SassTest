# ADR-0008: Google Cloud como plataforma de despliegue

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

Requisito de producto: funcionar primero en local y desplegarse después en Google Cloud.
La decisión aquí es **cómo** encajamos en GCP minimizando lock-in y coste inicial.

## Decisión

- Runtime: **Cloud Run** para web/api/worker (contenedores estándar → portabilidad).
- Datos: **Cloud SQL PostgreSQL**; secretos en **Secret Manager**; imágenes en **Artifact Registry**.
- CI/CD: **GitHub Actions con Workload Identity Federation** — prohibidas las claves JSON de service account.
- Región **europe-west1** (residencia UE).
- **BigQuery NO entra en el MVP**: `usage_events` vive en PostgreSQL tras la interfaz `UsageEventSink`; el export a BigQuery es una implementación adicional futura (dual-write o batch), sin tocar productores de eventos.
- Entornos staging/production en **proyectos GCP separados**.

Diseño completo y checklist: `docs/deployment/GCP_DEPLOYMENT.md`; esqueleto IaC en `infra/terraform/`.

## Alternativas consideradas

- **GKE** — sobredimensionado: coste base y operación de cluster sin necesidad a esta escala.
- **App Engine** — modelo más rígido y en decadencia frente a Cloud Run.
- **BigQuery desde el día 1** — complejidad (streaming inserts, IAM, costes) sin volumen que lo justifique; la abstracción elimina el coste de posponerlo.

## Consecuencias

- (+) Coste ~0 en local, bajo en staging (escala a 0); contenedores estándar = migrables.
- (−) El worker con BullMQ necesita min-instances=1 (Cloud Run no despierta por Redis); la migración a Cloud Tasks (ADR-0005) lo resuelve.
- Nada se despliega aún: este ADR fija el destino para que ninguna decisión local lo contradiga.
