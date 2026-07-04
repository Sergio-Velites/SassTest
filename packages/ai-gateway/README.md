# @flowhub/ai-gateway

Capa de IA agnóstica de proveedor. Incluye el contrato `AiProvider` y `MockAiProvider` determinista (sin red, coste 0) para tests y desarrollo local.

Providers reales (OpenAI/Anthropic) llegan en el Ciclo 8 vía env vars. Reglas: prompts versionados fuera de la lógica de negocio, trazas de coste/latencia por llamada, structured output con Zod. Ver ADR-0007.
