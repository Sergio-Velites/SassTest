# infra/terraform

IaC completo del despliegue en Google Cloud (ADR-0008). **Nunca aplicado aún** —
requiere que el propietario cree los proyectos GCP. `terraform validate` pasa en
ambos environments; el `plan/apply` real necesita credenciales.

## Estructura

```
modules/stack/         → todo el stack de un environment: APIs, VPC (+PSA y
                         VPC connector), Cloud SQL 16 privado, Memorystore,
                         Artifact Registry, Secret Manager, SAs de mínimo
                         privilegio, Cloud Run ×3 + job de migraciones, WIF.
environments/staging/     → instancia del módulo (min_instances=0, db pequeña)
environments/production/  → ídem (min_instances=1, db mayor, deletion_protection,
                            HA regional en Cloud SQL)
```

Decisiones de diseño:

- Los servicios llevan `ignore_changes` en la imagen: **el pipeline** (deploy.yml)
  rueda revisiones con gcloud; terraform gestiona la forma, no los rollouts.
- El primer apply usa una imagen placeholder pública para no depender del orden
  imagen↔infra.
- Los secretos de IA se crean vacíos; un operador añade versiones con
  `gcloud secrets versions add` (nunca via terraform/estado).
- El worker es `INGRESS_TRAFFIC_INTERNAL_ONLY` con `min_instances=1` (consumidor
  BullMQ; ver ADR-0005 para la migración futura a Cloud Tasks).

## Pasos del propietario (una sola vez por environment)

```bash
# 0. Requisitos: gcloud CLI autenticado y proyecto creado con billing:
#    flowhub-staging (y después flowhub-prod)

# 1. Bucket de estado (una vez, en el proyecto de staging):
gcloud storage buckets create gs://flowhub-terraform-state \
  --project flowhub-staging --location europe-west1 --uniform-bucket-level-access
gcloud storage buckets update gs://flowhub-terraform-state --versioning

# 2. Aplicar staging:
cd environments/staging
cp terraform.tfvars.example terraform.tfvars   # editar project_id si difiere
# descomentar el bloque backend "gcs" en main.tf
gcloud auth application-default login
terraform init && terraform plan && terraform apply

# 3. Conectar GitHub (Settings → Environments → staging → variables):
#    GCP_PROJECT_ID, GCP_REGION=europe-west1,
#    GCP_WIF_PROVIDER  = output workload_identity_provider
#    GCP_DEPLOY_SA     = output deploy_service_account
#    (tras el primer deploy) NEXT_PUBLIC_API_URL = output api_url

# 4. Merge a main → deploy.yml construye, migra y despliega staging.
# 5. Repetir 2-3 con environments/production; production despliega al publicar release.
```

Reglas: tfvars y tfstate jamás al repo (.gitignore ya los excluye); cambios de
infra por PR con `terraform plan` adjunto; sin claves JSON de service accounts.
