# @flowhub/shared

Primitivas de dominio compartidas: IDs branded (previenen mezclar IDs entre entidades/tenants), `Result<T,E>`, `AppError` con códigos estables y `TenantContext` + `assertSameTenant` (defensa en profundidad multi-tenant, responde NOT_FOUND para no filtrar existencia de datos ajenos).
