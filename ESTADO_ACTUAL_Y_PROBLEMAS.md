# Estado Actual del Sistema - Julio 6, 2026

## ✅ Lo Que Funciona Bien

### Sistema Implementado
- ✅ Corte Santo automatizado (julio 3-5 validados)
- ✅ Reconciliación bancaria funcionando
- ✅ Dashboard con vistas de Cortes, Socios, Conciliación
- ✅ Sistema de preguntas IA (12 de 25 con respuesta SQL directa)
- ✅ Workflow de dos etapas (inicial + bancos)
- ✅ Tablas canónicas: `corte_daily_records`, `corte_receivables`

### Datos Validados
- ✅ Julio 1 y 2: Datos correctos en Excel de Drive
- ✅ Julio 3-5: Pendientes de validación completa pero deberían estar bien

---

## ❌ Problemas Reportados (Julio 6)

### 1. Julio 2: Diferencia Incorrecta
**Síntoma**: El dashboard muestra que julio 2 tiene una diferencia de reconciliación

**Contexto**:
- El Excel en Drive está correcto para julio 2
- Julio 1 se validó correctamente
- El sistema NO debería mostrar diferencia

**Posibles Causas**:
- `revision_document.reconciliation_totals.difference` tiene un valor != 0
- Error en el cálculo de Total Real vs Total Sistema
- Datos de `workflow_runs.output_payload` inconsistentes con Excel

**Acción Requerida**:
- [ ] Revisar `workflow_runs` para `business_date='2026-07-02'`
- [ ] Verificar `revision_document.reconciliation_totals`
- [ ] Comparar con datos del Excel
- [ ] Re-procesar julio 2 si es necesario

---

### 2. Julio 1-2: Sin Forecast
**Síntoma**: Julio 1 y 2 no muestran forecast, pero el resto del mes sí

**Contexto**:
- Julio 3-5 (y presumiblemente el resto) tienen forecast
- El sistema busca forecast en `revision.vta_por_dia[].meta_vta`
- También busca `drive_file_ids.forecast` en el payload

**Posibles Causas**:
- Los workflow runs de julio 1-2 no tienen `vta_por_dia` poblado
- El documento forecast no estaba disponible cuando se procesaron
- El forecast se subió después de procesar julio 1-2

**Acción Requerida**:
- [ ] Verificar si existe documento forecast para julio
- [ ] Verificar `workflow_runs` julio 1-2 tienen `drive_file_ids.forecast`
- [ ] Re-procesar julio 1-2 con forecast actualizado

---

### 3. "Falta por entrar" No Se Muestra
**Síntoma**: Después de validar bancos de julio 1, el dashboard no muestra "Falta por entrar"

**Contexto**:
- Julio 1 se cargó con banco y se validó
- El dashboard usa `getOutstandingThroughDate()` para calcular pendiente
- Busca `falta_por_entrar` o `pending_collections` en varios lugares del payload

**Posibles Causas**:
- `revision_document.falta_por_entrar` no se actualizó después de validar bancos
- `bank_reconciliation.pending_collections` no está en el formato correcto
- La función `getOutstandingThroughDate()` no está encontrando los datos

**Acción Requerida**:
- [ ] Revisar `workflow_runs` julio 1 después de validación bancaria
- [ ] Verificar estructura de `falta_por_entrar` en payload
- [ ] Verificar que el bank watcher actualizó el documento de revisión

---

### 4. Preguntas IA: Completar Implementación
**Síntoma**: Sistema implementado pero falta validar funcionamiento completo

**Estado Actual**:
- ✅ 12 preguntas con respuesta SQL directa
- ✅ 13 preguntas con fallback a Claude/Gemini
- ⏳ Falta probar con datos reales
- ⏳ Queries SQL pueden necesitar ajustes

**Preguntas Prioritarias a Validar**:
1. "¿Cuánto de las ventas de American Express se depositó hoy?"
2. "¿Cuánto falta por depositarse de Banorte?"
3. "¿Qué porcentaje son las cuentas por cobrar?"
4. "¿Cuánto se requiere del efectivo para propinas en junio?"
5. "¿Cuál fue el monto total de ventas de Uber en junio?"

**Acción Requerida**:
- [ ] Probar las 25 preguntas con datos de julio
- [ ] Verificar que las respuestas coinciden con Excel
- [ ] Ajustar queries SQL si hay discrepancias
- [ ] Documentar qué preguntas funcionan vs cuáles necesitan LLM

---

## 🔧 Plan de Acción Inmediato

### Prioridad 1: Diagnóstico (30 min)
1. Revisar workflow_runs en Supabase para julio 1-2
2. Verificar estructura de datos vs lo esperado
3. Identificar causa raíz de cada problema

### Prioridad 2: Fixes (2-3 horas)
1. **Julio 2 diferencia**: 
   - Opción A: Re-procesar con datos correctos
   - Opción B: Actualizar manualmente `revision_document`

2. **Forecast julio 1-2**:
   - Opción A: Re-procesar con forecast actual
   - Opción B: Actualizar `vta_por_dia` en payload existente

3. **Falta por entrar**:
   - Opción A: Re-ejecutar bank watcher para julio 1
   - Opción B: Actualizar `falta_por_entrar` en revision

### Prioridad 3: Validación Preguntas IA (1-2 horas)
1. Probar las 25 preguntas desde el dashboard
2. Verificar respuestas con datos reales
3. Ajustar queries si es necesario
4. Documentar resultados

### Prioridad 4: Documentación (2-3 horas)
1. Crear PDF explicando workflow completo
2. Documentar decisiones de sistema
3. Explicar de dónde sale cada dato
4. Incluir ejemplos con julio 1-5

---

## 📊 Datos Para Investigación

### Queries Útiles

```sql
-- Ver workflow runs de julio 1-2
SELECT 
  business_date,
  status,
  output_payload->'bank_validation_status' as bank_status,
  output_payload->'revision_document'->'reconciliation_totals' as reconciliation,
  output_payload->'revision_document'->'falta_por_entrar' as falta_por_entrar,
  created_at
FROM workflow_runs
WHERE business_date IN ('2026-07-01', '2026-07-02')
  AND source_channel = 'agent_mail'
ORDER BY business_date, created_at DESC;

-- Ver datos canónicos de julio 1-2
SELECT 
  business_date,
  venta_bruta,
  total_bruto,
  forecast_target,
  amex,
  debito + credito as banorte,
  efectivo,
  uber_eats,
  rappi,
  propinas
FROM corte_daily_records
WHERE business_date IN ('2026-07-01', '2026-07-02');

-- Ver documentos forecast
SELECT 
  document_key,
  drive_file_id,
  metadata,
  created_at
FROM documents
WHERE document_type = 'forecast_workbook'
ORDER BY created_at DESC
LIMIT 5;

-- Ver cuentas por cobrar abiertas
SELECT 
  opened_on,
  principal,
  settled_principal,
  status,
  evidence->>'channel' as channel
FROM corte_receivables
WHERE status = 'open'
  AND opened_on <= '2026-07-02'
ORDER BY opened_on DESC;
```

---

## 🎯 Objetivos del Día

1. ✅ **[AHORA]** Diagnosticar los 3 problemas de julio 1-2
2. ✅ **[AHORA]** Arreglar problemas encontrados
3. ✅ **[HOY]** Validar que preguntas IA funcionan perfectamente
4. ✅ **[HOY]** Crear documentación completa del workflow

---

## 📝 Notas Importantes

### Sobre Re-procesamiento
- Si necesitamos re-procesar julio 1-2, usar `reprocess-corte.yml` workflow
- Asegurarse que forecast esté disponible antes de re-procesar
- Documentar cambios en `ai_brain/session_log.md`

### Sobre Validación
- Julio 1-2 son críticos porque fueron los primeros días
- Julio 3-5 esperan validación bancaria
- Todo el mes debe ser consistente para reportes

### Sobre Documentación
- El cliente necesita entender cada decisión del sistema
- PDF debe ser visual y fácil de seguir
- Incluir ejemplos reales de julio 1-5

---

## 🔗 Archivos Relacionados

### Código Principal
- `apps/dashboard/src/lib/corte-data.ts` - Extracción revision document
- `apps/dashboard/src/lib/corte-dashboard-utils.ts` - Cálculos forecast
- `apps/dashboard/src/app/api/cortes/ai/route.ts` - Preguntas IA
- `services/ai/questions.py` - Sistema preguntas Python

### Documentación
- `ai_brain/current_state.md` - Estado actual del proyecto
- `docs/04_workflows/corte_santo_operating_procedure.md` - Procedimiento operativo
- `SISTEMA_PREGUNTAS_IA_COMPLETADO.md` - Sistema preguntas IA

### Datos
- Supabase: `workflow_runs`, `corte_daily_records`, `corte_receivables`
- Drive: Folder `1sN9QP54zdwgprH0-LUJwCVLtd4OY9vsL` (Cortes/REVISION)

---

**Última actualización**: Julio 6, 2026
**Estado**: 🚨 Problemas críticos requieren atención inmediata
