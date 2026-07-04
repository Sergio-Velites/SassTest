# Security Policy

## Reportar vulnerabilidades

**No abras issues públicas para vulnerabilidades.**

Usa un [GitHub Security Advisory privado](https://github.com/Sergio-Velites/SassTest/security/advisories/new)
o escribe a `apps@velitessport.com` con:

- Descripción y severidad estimada.
- Pasos de reproducción.
- Impacto (qué datos/tenants podrían verse afectados).

Compromiso de respuesta: acuse en 72h, evaluación en 7 días.

## Alcance

Aplica a todo el monorepo: apps, packages, infraestructura y CI.
Especial interés en:

- Aislamiento multi-tenant (acceso a datos de otra organización).
- Fugas de secretos o credenciales de conectores.
- Bypass de autorización en endpoints o en el motor de workflows.
- Inyección a través de definiciones de workflows o inputs de nodos.

## Principios de seguridad del proyecto

- Secretos jamás en el repo: `.env` está ignorado; en cloud se usa GCP Secret Manager.
- CI sin credenciales cloud estáticas (Workload Identity Federation cuando haya despliegue).
- Toda tabla tenant-owned lleva `organization_id` y toda query filtra por él.
- Logs estructurados con redacción automática de tokens/credenciales.
- Dependencias vigiladas con Dependabot + `pnpm audit` + gitleaks en CI.

Modelo completo de amenazas y controles: [docs/security/SECURITY_MODEL.md](docs/security/SECURITY_MODEL.md).

## Versiones soportadas

Pre-MVP: solo la rama `main` recibe correcciones.
