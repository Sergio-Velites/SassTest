# API — documentación

**Estado: pendiente (Ciclos 3 y 5).**

La API se documenta a sí misma: los schemas Zod de cada ruta generan el OpenAPI,
servido en `/docs` por `@fastify/swagger` cuando la API exista. Este directorio
guardará, además:

- Convenciones de la API (paginación, errores, versionado de rutas).
- Decisiones de diseño de endpoints que no quepan en el OpenAPI.

## Convenciones ya decididas

- REST, JSON, rutas en plural kebab-case (`/installed-workflows/:id/executions`).
- Errores: `{ error: { code: AppErrorCode, message: string } }` con códigos estables de `@flowhub/shared` — mapeo: VALIDATION_ERROR→400, UNAUTHORIZED→401, FORBIDDEN→403, NOT_FOUND→404, CONFLICT→409, RATE_LIMITED→429, resto→500.
- Paginación por cursor (`?cursor=&limit=`), `limit` máximo 100.
- Toda ruta autenticada opera dentro del tenant de la sesión; nunca se acepta `organizationId` del cliente para seleccionar datos.
