# ADR-0009: Seguridad del repositorio GitHub

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

El repo es la cadena de suministro del producto. Debe ser seguro desde el primer commit:
sin secretos, con revisión obligatoria y scanning continuo.

## Decisión

1. **Repositorio privado**; `main` protegida: PR obligatoria, review de CODEOWNER, checks de CI verdes, sin force-push. (Configuración manual documentada en `infra/github/BRANCH_PROTECTION.md` — la API de GitHub la puede automatizar después.)
2. **CI** (`ci.yml`): format, lint, typecheck, test, build con lockfile congelado.
3. **Security** (`security.yml`): `pnpm audit` (high+) y **gitleaks** en cada PR + barrido semanal. **Code scanning (CodeQL)** se activa vía settings del repo (default setup) — placeholder documentado.
4. **Secret scanning + push protection** de GitHub activados en settings del repo.
5. **Dependabot**: npm y github-actions, semanal, agrupando minor/patch.
6. **Conventional Commits** obligatorios; plantillas de PR/issues con checklist de seguridad.
7. CI **sin credenciales cloud estáticas**: cuando haya despliegue, WIF/OIDC (ADR-0008).
8. `.gitignore` estricto (env, claves, tfstate, tfvars) y `.env.example` como único contrato de configuración commiteado.

## Alternativas consideradas

- **Gitleaks vs. solo GitHub secret scanning** — se usan ambos: gitleaks corre en PR (feedback inmediato pre-merge) y el de GitHub cubre push protection e histórico.
- **Commitlint en CI** — pospuesto: el equipo es pequeño y la plantilla de PR lo cubre; se añade si aparecen commits fuera de convención.

## Consecuencias

- (+) Cadena de suministro razonablemente protegida con coste de mantenimiento mínimo.
- (−) Branch protection y secret scanning requieren configuración manual en GitHub (no viven en el repo) — checklist en `infra/github/BRANCH_PROTECTION.md` para no olvidarlo.
