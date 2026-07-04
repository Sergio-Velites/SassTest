# Contribuir a FlowHub AI

## Flujo de trabajo

1. Crea una rama desde `main`: `feat/<descripcion>` o `fix/<descripcion>`.
2. Desarrolla con el pipeline en verde: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
3. Abre una Pull Request — `main` está protegida, no se puede pushear directo.
4. La PR debe pasar los checks de CI y la revisión de un CODEOWNER.

## Commits — Conventional Commits

```
feat(api): add workflow installation endpoint
fix(engine): retry transient connector failures
docs: update data model with approval_requests indexes
chore(ci): bump pnpm action
refactor(shared): extract tenant guard
test(engine): cover branch edges
```

Tipos permitidos: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `perf`.
Scope opcional = app o paquete afectado.

## Estándares de código

- TypeScript estricto; `any` prohibido salvo `eslint-disable` justificado en línea.
- Input/output externo validado con Zod.
- IDs con branded types de `@flowhub/shared`.
- Lógica de negocio sin SDKs directos (IA → ai-gateway, herramientas → connectors).
- Logs solo vía `@flowhub/observability` (nunca `console.log`).
- Tests junto al código (`src/*.test.ts`, `node:test`).
- Convenciones completas: [CLAUDE.md](CLAUDE.md) §5.

## Seguridad (bloqueante en revisión)

- Sin secretos en el diff (el CI ejecuta gitleaks, pero no dependas de él).
- Queries nuevas a tablas tenant-owned filtran por `organization_id`.
- Endpoints nuevos exigen `TenantContext` y validación Zod.
- Cambios en `docs/security/`, `infra/` o `.github/` requieren revisión del owner.

## Documentación

- Decisión de arquitectura → nuevo ADR en `docs/decisions/` (usa `TEMPLATE.md`).
- Cambio de estado del proyecto → actualizar `CLAUDE.md` §2 y `README.md`.
- Cambio en el motor o el modelo de datos → actualizar el doc de especificación correspondiente.

## Añadir dependencias

Justifica cada dependencia nueva en la PR. Preferimos utilidades pequeñas sin
dependencias antes que librerías grandes para una sola función.
