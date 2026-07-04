# Despliegue en Google Cloud — FlowHub AI

**Estado: diseño (no desplegado).** Este documento prepara el despliegue para cuando
se decida ejecutarlo. El esqueleto de Terraform vive en `infra/terraform/`.

## 1. Arquitectura en GCP

```
                    Internet
                       │
             Cloud Load Balancing + Cloud Armor (opcional fase 2)
                       │
        ┌──────────────┼─────────────────┐
        ▼              ▼                 │
  Cloud Run: web  Cloud Run: api    Cloud Run: worker (min-instances=1)
        │              │                 │
        │              ├────────► Cloud SQL (PostgreSQL 16, private IP)
        │              ├────────► Memorystore Redis (fase BullMQ)
        │              │            └─ alternativa objetivo: Pub/Sub + Cloud Tasks
        │              └────────► Secret Manager (runtime secrets)
        │
  Artifact Registry (imágenes) ◄── GitHub Actions (WIF/OIDC, sin claves)
  Cloud Storage (documentos)   ·  Cloud Logging / Error Reporting / Monitoring
  BigQuery (analítica futura, export de usage_events)
```

**Región:** `europe-west1` (Bélgica) por residencia UE y disponibilidad de servicios.
Alternativa `europe-southwest1` (Madrid) si la latencia a España pesa más que el coste.

## 2. Servicios necesarios

| Servicio                                     | Uso                                                        | Cuándo                                    |
| -------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| Cloud Run                                    | web, api, worker (contenedores stateless)                  | Primer despliegue                         |
| Cloud SQL PostgreSQL 16                      | BD principal (private IP + Cloud SQL Auth Proxy/connector) | Primer despliegue                         |
| Artifact Registry                            | Imágenes Docker                                            | Primer despliegue                         |
| Secret Manager                               | Todos los secretos de runtime                              | Primer despliegue                         |
| Memorystore Redis                            | Cola BullMQ                                                | Primer despliegue (si se mantiene BullMQ) |
| Pub/Sub / Cloud Tasks                        | Sustituto gestionado de la cola (ADR-0005)                 | Fase 2                                    |
| Cloud Storage                                | Documentos/ficheros de clientes                            | Cuando haya ficheros reales               |
| Cloud Logging / Error Reporting / Monitoring | Observabilidad                                             | Primer despliegue (automático + alertas)  |
| BigQuery                                     | Export de usage_events para analítica                      | Fase 3 (ADR y abstracción ya preparados)  |
| Cloud Build **o** GitHub Actions             | CI/CD                                                      | GitHub Actions elegido (ADR-0009)         |

## 3. Entornos

| Entorno    | Proyecto GCP       | Rama                          | Despliegue                               |
| ---------- | ------------------ | ----------------------------- | ---------------------------------------- |
| local      | — (docker-compose) | cualquiera                    | manual                                   |
| staging    | `flowhub-staging`  | `main` (auto)                 | GitHub Actions al mergear                |
| production | `flowhub-prod`     | tag/release (manual approval) | GitHub Actions con environment protegido |

Proyectos GCP **separados** por entorno (aislamiento IAM y de presupuesto). Nada de
staging y prod en el mismo proyecto.

## 4. Variables de entorno y Secret Manager

- Config no sensible (puertos, flags, URLs públicas): variables de entorno normales en la definición del servicio Cloud Run (gestionadas por Terraform).
- Secretos (`DATABASE_URL`, `AUTH_SESSION_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, clave de cifrado de conectores): **Secret Manager**, montados como env vars con `secret_key_ref`. Versionado y rotación nativas.
- El mismo contrato de `.env.example` aplica en todos los entornos — `packages/config` valida al arrancar y el servicio no levanta con config inválida.

## 5. Cloud SQL

- PostgreSQL 16, private IP (sin IP pública), conexión desde Cloud Run vía Cloud SQL connector.
- Tier inicial: `db-custom-1-3840` (1 vCPU / 3.75GB) staging, `db-custom-2-7680` prod; escalar con métricas.
- Automated backups diarios + PITR 7 días. Maintenance window definida.
- Migraciones: job de Cloud Run (misma imagen del api, comando `migrate`) ejecutado por el pipeline **antes** de desplegar la nueva revisión.

## 6. Cloud Run (por servicio)

|                 | web                    | api      | worker                         |
| --------------- | ---------------------- | -------- | ------------------------------ |
| CPU/Mem inicial | 1/512Mi                | 1/512Mi  | 1/1Gi                          |
| Min instances   | 0 (staging) / 1 (prod) | 0 / 1    | 1 (siempre; consume cola)      |
| Concurrency     | 80                     | 80       | 1–10 (por diseño del executor) |
| Ingress         | all                    | all      | internal-only                  |
| Service account | `web-sa`               | `api-sa` | `worker-sa`                    |

## 7. IAM mínimo por servicio

Principio: una service account por servicio, roles mínimos, sin `roles/editor` jamás.

| SA                                             | Roles                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-sa`                                       | `cloudsql.client`, `secretmanager.secretAccessor` (solo sus secretos), `redis` según red                                                     |
| `worker-sa`                                    | como api-sa + publicador/consumidor de la cola                                                                                               |
| `web-sa`                                       | `secretmanager.secretAccessor` (solo sesión)                                                                                                 |
| `deploy-sa` (usada por GitHub Actions vía WIF) | `run.developer`, `artifactregistry.writer`, `iam.serviceAccountUser` (solo sobre las SAs de runtime), `cloudsql.client` (job de migraciones) |

## 8. CI/CD con Workload Identity Federation (sin claves JSON)

**Nunca claves JSON de service account.** GitHub Actions se autentica con OIDC:

1. Crear Workload Identity Pool + Provider apuntando a `token.actions.githubusercontent.com`.
2. Condición del provider restringida a este repo y (para prod) al environment `production`.
3. `google-github-actions/auth@v2` con `workload_identity_provider` + `service_account: deploy-sa`.
4. Pipeline: build imagen → push a Artifact Registry → job de migraciones → deploy revisión Cloud Run → smoke test → (prod) shift de tráfico.

Si algún flujo local requiriese credenciales: usar `gcloud auth application-default login`
(credenciales de usuario de corta vida), documentado — jamás descargar claves.

## 9. Rollbacks

- Cloud Run conserva revisiones: rollback = redirigir tráfico a la revisión anterior (`gcloud run services update-traffic ... --to-revisions=REV=100`), < 1 minuto.
- Migraciones: **expand/contract** — las migraciones del release N deben ser compatibles con el código N-1. Nunca borrar columnas en el mismo release que deja de usarlas.
- Imágenes inmutables etiquetadas por SHA de commit → reproducibilidad exacta.

## 10. Logs y monitoring

- Logs JSON de las apps → Cloud Logging automáticamente (structured logging ya preparado en observability).
- Error Reporting agrupa excepciones no controladas.
- Alertas mínimas al arrancar: error rate api > 2%, p95 latencia > 1s, profundidad de cola creciente 15 min, fallos de job de migración, uptime check de `/health`.

## 11. Control de costes

- Presupuestos por proyecto con alertas a 50/80/100%.
- Escala a 0 en staging; `max-instances` en todos los servicios (evitar runaway).
- Coste IA con cap por organización a nivel de aplicación (`AI_MONTHLY_COST_CAP_USD`).
- Estimación inicial (staging + prod mínimos): Cloud SQL ~70€/mes, Cloud Run ~10–40€/mes, Memorystore ~35€/mes, resto marginal. Revisar tras primer mes.

## 12. Checklist del primer despliegue (cuando se decida)

1. Crear proyectos `flowhub-staging` / `flowhub-prod` + billing + presupuestos.
2. `infra/terraform`: rellenar `terraform.tfvars` (ver `variables.tf`), `terraform apply` en staging.
3. Configurar WIF y `deploy-sa`; añadir `workload_identity_provider` como variable (no secreto) del repo.
4. Añadir workflow `deploy.yml` (staging on merge, prod on release).
5. Sembrar Secret Manager con secretos generados (no reutilizar los de local).
6. Smoke test end-to-end en staging; después habilitar prod.
