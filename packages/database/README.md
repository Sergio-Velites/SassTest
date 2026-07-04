# @flowhub/database

Esquema Drizzle ORM (27 tablas + catálogos), cliente pg y migraciones versionadas.
Fuente de especificación: `docs/architecture/DATA_MODEL.md` — mantener en sync.

## Comandos

```bash
pnpm --filter @flowhub/database db:generate   # generar migración desde el schema
pnpm --filter @flowhub/database db:migrate    # aplicar migraciones (usa DATABASE_URL)
pnpm --filter @flowhub/database db:seed       # seed idempotente de desarrollo
pnpm db:reset                                 # (raíz) drop + migrate + seed
```

## Reglas

- Toda tabla tenant-owned lleva `organization_id NOT NULL` + índice compuesto; toda query filtra por él.
- Migraciones inmutables una vez commiteadas: crear una nueva, nunca editar.
- Enums como `text` + CHECK constraint. Emails/slugs en `citext` (la migración 0000 crea la extensión).
- Los tests de `src/db.test.ts` corren contra BD viva cuando `DATABASE_URL` está definida (CI levanta postgres:16 como service) y se saltan si no.
- El seed valida la definición del Invoice Intake Demo con `workflowDefinitionSchema` antes de insertarla, y se niega a correr con `NODE_ENV=production`.
