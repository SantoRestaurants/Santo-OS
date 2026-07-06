# AI Question Answering System

Sistema de respuestas a preguntas financieras predefinidas para Santo AI OS.

## Descripción

Este módulo maneja 25 preguntas predefinidas sobre datos financieros usando lógica de negocio y queries SQL directas en lugar de depender de interpretación de LLM. Esto asegura:

- **Precisión**: Respuestas basadas en cálculos exactos de la base de datos
- **Velocidad**: Sin latencia de APIs externas para cada pregunta
- **Costos**: No se gastan tokens de Claude/Gemini en preguntas repetitivas
- **Confiabilidad**: Lógica determinística y predecible

## Arquitectura

```
services/ai/
├── questions.py          # Sistema principal de identificación y respuestas
├── test_questions.py     # Tests de identificación (25/25 pasando)
├── classifier.py         # Clasificación de emails con Claude (existente)
└── README.md            # Esta documentación
```

## Categorías de Preguntas

### Depósitos Diarios (1-4)
- Q1: Depósitos AMEX del día
- Q2: Depósitos Banorte del día  
- Q3: Pendientes AMEX
- Q4: Pendientes Banorte

### Cuentas por Cobrar (5, 11-16)
- Q5: Porcentaje CxC vs ventas totales
- Q11-12: Depositado por canal en período
- Q13-14: Pendiente al cierre de mes
- Q15-16: Depósitos cross-month (Mayo→Junio)

### Efectivo y Propinas (6-10)
- Q6: Efectivo requerido para propinas
- Q7: Efectivo real de ventas
- Q8: Efectivo de cortesías
- Q9: Desglose propinas vs ventas en depósitos
- Q10: Porcentaje propinas vs ventas

### Comisiones (17, 22-23)
- Q17: Tasa de comisión AMEX (sin IVA)
- Q22: Porcentaje comisión Uber
- Q23: Porcentaje comisión Rappi

### Ventas de Plataformas (18-21, 24-25)
- Q18-19: Ventas totales Uber/Rappi
- Q20-21: Depósitos totales Uber/Rappi
- Q24-25: Porcentaje ventas Uber/Rappi vs total

## Uso

### Desde el Dashboard (Next.js/TypeScript)

El endpoint `/api/cortes/ai` ya existe y debe ser modificado para usar este sistema:

```typescript
// En apps/dashboard/src/app/api/cortes/ai/route.ts

import { QuestionAnswerer } from '@python/services/ai/questions';

export async function POST(request: Request) {
  const { supabase } = await authorizeRequest(["supervisor", "socio"]);
  const body = await request.json();
  
  const answerer = new QuestionAnswerer(supabase);
  const result = await answerer.answer(body.question, {
    business_date: body.businessDate,
    unit: body.unit,
  });
  
  if (result.confidence >= 0.9) {
    return NextResponse.json({ answer: result.answer });
  }
  
  // Fallback a Claude/Gemini para preguntas no reconocidas
  // ... código existente ...
}
```

### Desde Python

```python
from services.ai.questions import QuestionAnswerer

# Crear answerer con cliente Supabase
answerer = QuestionAnswerer(supabase_client)

# Responder pregunta
result = await answerer.answer(
    question="¿Cuánto de las ventas procesadas por American Express se depositó en la cuenta bancaria el día de hoy?",
    context={
        "business_date": "2026-07-01",
        "unit": "SANTO"
    }
)

print(result["answer"])
# -> "De las ventas de American Express, se depositaron $12,345.67 en la cuenta bancaria el día de hoy."
```

## Testing

```bash
# Ejecutar todos los tests
python -m pytest services/ai/test_questions.py -v

# Ejecutar solo tests de identificación
python -m pytest services/ai/test_questions.py::TestQuestionIdentification -v

# Ejecutar test específico
python -m pytest services/ai/test_questions.py::TestQuestionIdentification::test_q1_amex_deposits_today -v
```

**Estado actual**: ✅ 25/25 tests de identificación pasando

## Trabajo Pendiente

### 1. Implementar Queries SQL Reales

Actualmente todos los métodos `_query_*` retornan valores placeholder (0.0). Necesitan implementarse con queries reales a Supabase:

**Prioridad Alta:**
- `_query_bank_deposits()` - Q1, Q2
- `_query_pending_receivables()` - Q3, Q4
- `_query_total_receivables()` - Q5
- `_query_total_sales()` - Q5
- `_query_platform_sales()` - Q18, Q19
- `_query_platform_deposits()` - Q20, Q21

**Prioridad Media:**
- `_query_tips_cash()` - Q6
- `_query_cash_sales()` - Q7
- `_query_bank_breakdown()` - Q9
- `_query_tips_percentage()` - Q10
- `_query_deposited_by_channel()` - Q11, Q12
- `_query_pending_at_month_end()` - Q13, Q14

**Prioridad Baja:**
- `_query_courtesy_cash()` - Q8
- `_query_cross_month_deposits()` - Q15, Q16
- `_query_amex_commission_rate()` - Q17 (puede venir de config)
- `_query_platform_commission_pct()` - Q22, Q23
- `_query_platform_sales_pct()` - Q24, Q25

### 2. Mapear Estructura de Datos

Entender qué tablas y campos usar para cada query:

**Tablas principales:**
- `corte_daily_records` - Canal diario canónico (venta_bruta, total_bruto, propinas)
- `corte_receivables` - Ciclo de vida de CxC
- `workflow_runs` - Output payload con income_register, bank_reconciliation
- `documents` - Evidencia vinculada

**Ejemplo de query a implementar:**

```python
async def _query_bank_deposits(self, business_date: str, channel: str) -> Dict[str, float]:
    """Query actual bank deposits for a specific channel on a date"""
    
    # Opción 1: Desde workflow_runs bank_reconciliation
    result = await self.supabase
        .from("workflow_runs")
        .select("output_payload")
        .eq("business_date", business_date)
        .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
        .single()
    
    if result.data:
        bank_rec = result.data.get("output_payload", {}).get("bank_reconciliation", {})
        # Extraer depósitos del canal
        # ...
    
    # Opción 2: Desde corte_receivables (ledger events)
    # ...
    
    return {"deposited": deposited_amount}
```

### 3. Integrar con Dashboard

Modificar `apps/dashboard/src/app/api/cortes/ai/route.ts` para:

1. Intentar responder con `QuestionAnswerer` primero
2. Si `confidence >= 0.9`, retornar respuesta directa
3. Si `confidence < 0.9`, usar fallback Claude/Gemini existente

### 4. Añadir Tests de Integración

Una vez implementadas las queries reales:

```python
# services/ai/test_questions_integration.py

@pytest.mark.integration
async def test_q1_with_real_data(supabase_client):
    """Test Q1 with actual database data"""
    answerer = QuestionAnswerer(supabase_client)
    
    result = await answerer.answer(
        "¿Cuánto de las ventas procesadas por American Express se depositó en la cuenta bancaria el día de hoy?",
        {"business_date": "2026-07-01", "unit": "SANTO"}
    )
    
    assert result["confidence"] >= 0.9
    assert "American Express" in result["answer"]
    assert "$" in result["answer"]
```

### 5. Documentación de Usuario

Crear una guía para el cliente explicando:
- Las 25 preguntas disponibles
- Ejemplos de variaciones que también funcionan
- Cómo formular fechas y rangos
- Qué hacer si una pregunta no es reconocida

## Notas de Implementación

### Parse de Fechas

El sistema detecta automáticamente:
- **Nombres de meses**: "durante junio", "del mes de junio"
- **Fechas ISO**: "entre el día 2026-06-01 y el día 2026-06-30"
- **Años**: Asume año actual o más reciente

### Formato de Respuestas

- **Moneda**: `fmt_mxn(1234.56)` → `"$1,234.56"`
- **Porcentaje**: `fmt_pct(12.34)` → `"12.3%"`
- **Texto**: Español, directo, sin rodeos

### Manejo de Errores

- Si falta contexto requerido: `"No tengo la fecha del corte."`
- Si no hay datos: `"No tengo ese dato."`
- Si query falla: `"No pude calcular la respuesta: [error]"`
- Si pregunta no reconocida: Sugerencia de reformular

## Decisiones de Diseño

### ¿Por qué no usar LLM para todo?

1. **Costo**: 25 preguntas × N veces/día × tokens = alto costo
2. **Latencia**: Query SQL (50ms) vs Claude API (2-5s)
3. **Precisión**: SQL garantiza exactitud, LLM puede alucinar
4. **Auditabilidad**: Lógica determinística vs caja negra

### ¿Cuándo usar LLM?

- Preguntas no reconocidas (fuera de las 25)
- Preguntas complejas que combinan múltiples conceptos
- Preguntas que requieren explicación narrativa
- Análisis de tendencias o insights

El sistema actual ya tiene fallback a Claude/Gemini implementado en el endpoint.

## Contribuir

Al agregar nuevas preguntas:

1. Añadir método `_is_qN()` con patrón de identificación
2. Añadir método `_answer_qN()` con lógica de respuesta
3. Registrar en el array de `handlers` en `answer()`
4. Añadir test en `test_questions.py`
5. Documentar en este README

## Estado del Proyecto

- ✅ Estructura base implementada
- ✅ 25 patrones de identificación (tests passing)
- ✅ Sistema de parse de fechas
- ✅ Helpers de formato
- ⏳ Queries SQL reales (pendiente)
- ⏳ Integración con dashboard (pendiente)
- ⏳ Tests de integración (pendiente)

## Próximos Pasos Recomendados

1. **Implementar queries de Prioridad Alta** (Q1-Q5, Q18-Q21)
2. **Probar con datos reales de julio 2026**
3. **Integrar en dashboard** y verificar UX
4. **Completar queries restantes** según feedback
5. **Documentar para el cliente**
