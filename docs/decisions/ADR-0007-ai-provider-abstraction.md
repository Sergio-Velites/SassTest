# ADR-0007: Abstracción de providers de IA (AI Gateway)

- **Estado:** accepted
- **Fecha:** 2026-07-04

## Contexto

Los nodos IA son centrales en el producto. Riesgos: lock-in de provider, costes opacos,
prompts dispersos por el código, tests que dependen de APIs externas.

## Decisión

Paquete **`@flowhub/ai-gateway`** como única puerta a modelos de IA:

1. Interfaz `AiProvider` con implementaciones **mock** (default, determinista, sin red), **OpenAI** y **Anthropic** (Ciclo 8); **Gemini** preparado en el enum.
2. Selección por env var `AI_PROVIDER`; la lógica de negocio no conoce providers.
3. **Prompts como plantillas versionadas** (`ai_prompt_templates`, id lógico `slug@version`) — nunca inline en código de negocio.
4. **Structured output**: schema Zod/JSON Schema por llamada; respuesta validada, mismatch = error tipado.
5. **Traza obligatoria** por llamada (`ai_calls`): provider, modelo, tokens, coste estimado, latencia, estado.
6. **Guardrails**: budget mensual por organización con cap duro, truncado de inputs, timeouts, outputs de IA tratados como datos no confiables.

## Alternativas consideradas

- **SDKs directos en los handlers** — rápido hoy, deuda estructural mañana (lock-in, sin trazas uniformes, prompts imposibles de auditar).
- **LangChain u orquestadores** — abstracción enorme y volátil para lo que necesitamos (llamadas con schema + trazas); nuestra superficie es pequeña y estable.
- **Gateway externo (LiteLLM proxy)** — una pieza de infra más y las trazas de negocio (tenant, ejecución) las necesitamos igualmente en nuestra BD.

## Consecuencias

- (+) Tests y desarrollo local sin API keys; cambio de provider por configuración; coste por tenant medible desde el primer día (imprescindible para usage-based pricing).
- (−) Mantener el mock fiel a los contratos reales exige disciplina al añadir features de provider.
