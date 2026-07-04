# infra/terraform

Esqueleto de IaC para el despliegue futuro en Google Cloud. **No se ha aplicado nunca**:
no existe proyecto GCP todavía. Sirve para que el primer despliegue parta de una base
revisada en lugar de clicks en la consola.

## Estructura

```
environments/
  staging/     → main.tf que instancia los módulos con vars de staging
  production/  → ídem para producción (proyecto GCP separado)
modules/       → (futuro) módulos propios: cloud-run-service, cloud-sql, wif
versions.tf    → providers y versiones
variables.tf   → variables comunes documentadas
```

## Uso previsto (cuando toque)

```bash
cd environments/staging
cp terraform.tfvars.example terraform.tfvars   # completar; NUNCA commitear tfvars
terraform init                                  # backend GCS (crear bucket antes)
terraform plan
terraform apply
```

Reglas:

- Estado remoto en un bucket GCS con versioning (nunca tfstate en el repo — está en .gitignore).
- Autenticación con `gcloud auth application-default login` en local y WIF en CI. **Sin claves JSON.**
- Cambios de infra siempre por PR con `terraform plan` adjunto.

Checklist completo del primer despliegue: `docs/deployment/GCP_DEPLOYMENT.md` §12.
