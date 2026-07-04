# @flowhub/config

Configuración de entorno tipada y validada con Zod. Las apps llaman a `loadEnv()` una vez al arrancar; la lógica de negocio nunca lee `process.env` directamente. Los errores de validación nunca imprimen valores, solo nombres de claves.
