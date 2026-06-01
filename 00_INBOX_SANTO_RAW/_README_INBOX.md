# SantoOS Raw Intake Inbox

Esta carpeta es la zona de entrada para todo el contexto bruto de Santo AI OS.

No hace falta ordenar perfecto antes de tirar cosas aca. La idea es capturar material primero y procesarlo despues hacia Obsidian, docs, workflows, Supabase, AGENTS.md, CLAUDE.md o santo_context.md.

## Como usarla

- `01_cliente_instrucciones/`: instrucciones del cliente, briefs, prompts, mails, WhatsApps copiados, minutas y decisiones expresadas por Santo.
- `02_workflows_procesos/`: SOPs, procesos administrativos, payroll, corte, fiscal, accounting, HR y cualquier flujo operativo.
- `03_documentos_ejemplo/`: recibos, cortes, XMLs, facturas, documentos de empleado, evidencias y ejemplos anonimizados cuando sea posible.
- `04_screenshots_videos/`: capturas o videos de Drive, Sheets, sistemas actuales, dashboards o pasos manuales.
- `05_drive_sheets_exports/`: CSV, XLSX, exports de Google Sheets, listados de carpetas o datos tabulares.
- `06_credenciales_y_setup_NO_SUBIR/`: referencias locales temporales de credenciales o setup sensible. No versionar.
- `07_notas_sueltas/`: ideas, dudas, frases del cliente, notas rapidas y contexto todavia sin clasificar.
- `08_preguntas_pendientes/`: preguntas para confirmar con Santo antes de estructurar o construir.

## Regla de procesamiento

Cuando se ordene esta carpeta:

1. Leer todo lo nuevo en `00_INBOX_SANTO_RAW/`.
2. Clasificar por vision, workflow, dato, integracion, riesgo, credencial, decision o pendiente.
3. Convertir lo importante en documentos limpios dentro de `santo_context.md`, `docs/`, `workflows/`, `supabase/`, `AGENTS.md` o `CLAUDE.md`.
4. Dejar registro de que fue procesado y que sigue pendiente.
5. No borrar originales salvo pedido explicito.

## Seguridad

No guardar secretos reales en archivos versionados.

La carpeta `06_credenciales_y_setup_NO_SUBIR/` esta pensada para referencias locales temporales y debe permanecer ignorada por Git.
