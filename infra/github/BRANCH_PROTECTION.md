# Configuración de seguridad del repositorio GitHub

Estas opciones viven en los settings del repo (no en código). **Checklist para aplicar
manualmente** (o automatizar con la API/Terraform provider de GitHub más adelante).

## Branch protection de `main`

Settings → Branches → Add branch ruleset (o classic protection) para `main`:

- [x] Require a pull request before merging (1 approval, dismiss stale approvals)
- [x] Require review from Code Owners
- [x] Require status checks to pass: `Lint, typecheck, test, build`, `Dependency audit`, `Secret scan (gitleaks)`
- [x] Require branches to be up to date before merging
- [x] Block force pushes y deletions
- [x] Restrict who can push (nadie directo; solo vía PR)

## Security features

Settings → Security:

- [x] Private vulnerability reporting: **enabled**
- [x] Dependabot alerts + security updates: **enabled** (dependabot.yml ya en el repo)
- [x] Secret scanning: **enabled**
- [x] Push protection: **enabled**
- [x] Code scanning → CodeQL **default setup** (cubre TypeScript/JavaScript)

## Actions

Settings → Actions → General:

- [x] Workflow permissions: **Read repository contents** (default restrictivo; los workflows elevan por-job si lo necesitan)
- [x] Allow GitHub Actions to create and approve pull requests: **disabled**

## Recordatorios

- Nunca añadir secretos cloud estáticos en Settings → Secrets; el despliegue usará WIF/OIDC (ADR-0008).
- Revisar este checklist al crear el repo definitivo o transferirlo de organización.
