# Handoff — Corte Santo Full Workflow (sesión 2026-06-12)

Este documento resume el estado para retomar el trabajo del workflow Corte Santo
en una conversación nueva. Leer junto con `ai_brain/current_state.md`,
`ai_brain/build_rules.md` y los ADR-0009/0010/0011.

## Contexto del proyecto

SantoOS es un OS operativo AI-native para Santo (restaurantes). P0 prueba el
modelo con el workflow primario **Corte Santo** (conciliación diaria de ventas)
para **una unidad: SANTO**. Supabase/Postgres es la fuente de verdad; la IA
clasifica/valida/reconcilia/redacta pero NUNCA ejecuta acciones de banco/SAT/
nómina ni aprueba; lo incierto o sin config va a `requires_review`.

- Repo: https://github.com/SantoRestaurants/Santo-OS  (privado)
- Rama de trabajo histórica: `codex/p0-demo-drive-connector`; **main** está al día
  y es lo desplegado.
- Dashboard desplegado en Vercel (cuenta del cliente). Root Directory =
  `apps/dashboard`, framework Next.js. Commits deben ir firmados como
  `SantoRestaurants <developer@santorestaurants.com>` o Vercel (Hobby) bloquea
  el deploy.
- Supabase del cliente: `[CONFIRM_SUPABASE_PROJECT_URL]`. Variables en
  Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`.

## Cómo funciona el corte real (confirmado por el cliente)

El corte valida que el **cierre real (terminales/plataformas)** coincida con el
**cierre del sistema (Wansoft)**, forma por forma, con **tolerancia $0**. Llega
por mail con ~6-10 adjuntos: Excel del corte, reporte global Wansoft, cierres de
lote (AMEX/Banorte), detalle de efectivo, apps de entrega, descuentos. El
resultado final es el documento "REVISION" guardado en Drive + se actualizan los
Excel de Ingresos y Forecast.

### Reglas del workflow (notas de la reunión con el responsable)
- Comparar **gran total de las fotos** con el Excel.
- Tomar la **propina menor** entre la foto de la tira y las fotos de los bancos.
- A la **propina de efectivo de venta se le SUMA la cortesía en platillos** para
  el efectivo. (Verificado: 04-Jun Efectivo Excel 5,138.50 = 5,058.50 + 80
  cortesía.)
- Banco: si la descripción dice **"REST SANTO"** → Banorte; si no, mirar la
  descripción. SPEI de "AMERICAN EXPRESS" → Amex; "UBR PAGOS"/"UBER" → Uber.
- En la **hoja 2** de la descarga del banco: si no hay depósitos, verificar que
  abajo tampoco indique que debería haberlos.
- **Forecast**: se cargan metas del día y el siguiente; los **jueves** se cargan
  de jueves a domingo. Al insertar fila hay que extender el rango de
  `SUBTOTALES`.
- **Gastos adicionales** = cargos domiciliados (Spotify, pago TC, internet —
  dicen "domiciliación" en la descripción).
- **CXC** = cuenta por cobrar.
- Cobros pendientes por canal con tiempos: Banorte ~día siguiente, AMEX 3-5 días,
  Uber deposita lunes (lun-dom), Rappi viernes (vie-vie).
- Mail de validación a la mañana.

## Qué se construyó en esta sesión

1. **Reconciliación por forma de pago** (`workflows/corte_santo/script.py`):
   compara `cierre_terminal` vs `cierre_sistema` por grupo (amex, bancos,
   efectivo, transferencia, plataformas); Total Real debe == Total Sistema
   dentro de `thresholds.reconciliation_tolerance` (=0). Reemplazó el modelo
   viejo caja/depósito. (ADR-0009)
2. **`build_revision_document`**: arma el reporte REVISION en formato cliente.
3. **Extracción del Excel del corte** (`corte_excel_parser.py`): lee Cierre
   Ter/Pla y Cierre Sistema del .xlsx. (ADR-0010)
4. **Lector de fotos por visión** (`vision_extractor.py`): manda cada foto a un
   modelo de visión configurable (soporta **anthropic** y **gemini**), devuelve
   valores + confianza; gate de confianza → `requires_review` si baja/falla/sin
   key. (ADR-0011)
5. **Parser de estado de cuenta Banorte** (`bank_statement_parser.py`): clasifica
   depósitos por fuente con las reglas de keywords; depósitos no clasificados →
   review. (ADR-0011)
6. **Dashboard simplificado** para no técnicos (home = "lo que necesita tu
   revisión" + cortes recientes; sidebar = Inicio + Mis pendientes; tour en
   lenguaje llano). Sandbox actualizado a la lógica nueva + folder de Drive
   precargado.
7. Datos de prueba viejos borrados de Supabase (todas las tablas operativas en 0).

## VALIDADO con data real (carpeta de test del cliente, 04-Jun-2026)

Carpeta: `C:\Users\dchac\Documents\Proyectos\Santo AI OS\test` (fuera del
workspace; leer por terminal).

- **Gemini `gemini-2.5-flash`** leyó las 4 fotos bien (incluido el detalle de
  efectivo **manuscrito**). Claves que cuadran con el Excel lleno del cliente
  (`06- Santo-Ingresos Junio 2026`): Amex 9,909.45, Uber 3,525, Propinas
  6,582.60, Efectivo 5,138.50 (= 5,058.50 + 80 cortesía).
- Lección técnica: usar `maxOutputTokens` alto (>=4096) y `thinkingConfig.
  thinkingBudget=0`, porque 2.5-flash "piensa" y se queda sin tokens. Espaciar
  llamadas (rate limit del free tier).
- **Banorte CSV** parseado sin errores (47 filas: Banorte 378,467.32 / Uber
  15,543.82 / AMEX 113,230.36, 0 sin clasificar).

## Estado del workflow de dos etapas

La lógica ejecutable ya cubre el flujo solicitado:

1. Mail + evidencias -> conciliación -> Ingresos amarillo + Forecast -> Drive
   -> notificación -> espera de bancos.
2. Watcher detecta AMEX + Banorte -> matching de cobros esperados -> REVISION
   -> Ingresos azul -> Drive -> notificación -> completado.

Incluye lector AMEX `.xls`, matching transaccional, cobros pendientes,
escritura controlada de Excel y gates que impiden notificar/completar cuando
Drive, correo o la conciliación requieren revisión.

## Pendiente para declarar automatización completa en producción

1. Confirmar email real del supervisor, IDs de los Excel Ingresos/Forecast y
   folder observado para AMEX/Banorte.
2. Configurar credenciales estables de Drive, Agent Mail y Supabase.
3. Persistir el ledger de cobros esperados y el payload de reanudación en la
   corrida original de Supabase.
4. Desplegar/conectar el runner de Agent Mail y el watcher de Drive.
5. Pasar un correo diario real completo hasta la carga bancaria y comprobar
   Excel, REVISION, notificaciones y auditoría Supabase.

## Decisiones abiertas / inputs del cliente pendientes

- **Privacidad de visión**: Gemini **free tier USA los datos para entrenar**
  ("Used to improve our products: Yes"). Sirve para validar, NO para producción
  con datos del cliente. Producción → Gemini de pago (Flash $0.30/1M tokens,
  ~centavos/mes para 1 unidad) o Claude. El extractor ya es multi-proveedor.
- Confirmar carpeta de Drive del REVISION de SANTO: folder ID
  `1sN9QP54zdwgprH0-LUJwCVLtd4OY9vsL`. Falta credencial estable (el access token
  del OAuth Playground dura 1h; producción necesita service account o refresh
  token).
- Reviewer por tipo de excepción, severidades.

## Seguridad — ROTAR (secretos expuestos en el chat de la sesión)

- Supabase **service_role key** — rotar en Supabase → Settings → API.
- **Google OAuth refresh_token** del Playground — revocar en cuenta Google →
  Seguridad → accesos de terceros.
- **Gemini API key** (`AIza...`) — regenerar en aistudio.google.com.
Ninguno quedó en el repo; se usaron vía archivos temporales ya borrados.

## Próximo paso recomendado

Activar el runtime con configuración real y ejecutar la prueba end-to-end. La
lógica local ya no es el bloqueo; el bloqueo actual es operativo/de despliegue.

## Verificación al cierre de la sesión

- `python -m pytest workflows/corte_santo/` → 27 tests pasan (incluye parsers
  nuevos; los tests de visión degradan a review sin API key).
- Dashboard `tsc --noEmit` limpio; `npm run build` pasa.
