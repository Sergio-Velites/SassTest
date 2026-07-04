# Descripción

<!-- Qué cambia y por qué. Enlaza la issue si existe. -->

## Tipo de cambio

- [ ] Feature
- [ ] Fix
- [ ] Refactor
- [ ] Documentación
- [ ] Infraestructura / CI

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pasan en local
- [ ] Sin secretos, credenciales ni datos sensibles en el diff
- [ ] Toda query nueva filtra por `organization_id` (si aplica)
- [ ] Input/output validados con Zod (si aplica)
- [ ] Documentación actualizada (`CLAUDE.md`, docs/, ADR si hay decisión nueva)
- [ ] Commits siguen Conventional Commits

## Notas para revisión

<!-- Riesgos, decisiones tomadas, qué mirar con atención. -->
