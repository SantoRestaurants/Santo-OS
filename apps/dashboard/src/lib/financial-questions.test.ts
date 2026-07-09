import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerFinancialQuestion, resolveFinancialPeriod } from "./financial-questions";

const days = Array.from({ length: 30 }, (_, index) => ({
  business_date: `2026-06-${String(index + 1).padStart(2, "0")}`,
  venta_bruta: 100, propinas: 10, efectivo: 20, amex: 30, debito: 25, credito: 35, uber_eats: 5, rappi: 4, extra_values: {},
}));
const bankRuns = [{
  business_date: "2026-06-30", created_at: "2026-07-01T00:00:00Z", output_payload: { bank_reconciliation: {
    pending_items: [],
    matches: [{ deposit: { amount: 90, source: "amex", operation_date: "02/06/2026", description: "AMEX" }, expected_group: [{ source_date: "2026-05-31", amount: 90, channel: "amex", _original_amex: { cargos: 100 } }] }],
    deposits: [{ amount: 60, source: "banorte", operation_date: "03/06/2026", description: "REST SANTO" }],
  } },
}];
const context = {
  periodStart: "2026-06-01", periodEnd: "2026-06-30", effectiveDate: "2026-06-30", dailyRecords: days,
  receivables: [{ opened_on: "2026-06-10", principal: 50, settled_on: null, status: "open" }], bankRuns, latestBankRun: bankRuns[0],
};
const questions = [
  "¿Cuánto de las ventas procesadas por American Express se depositó en la cuenta bancaria el día de hoy?",
  "¿Cuánto de las ventas procesadas por las terminales de Banorte se depositó en la cuenta bancaria el día de hoy?",
  "¿Cuánto falta por depositarse en la cuenta bancaria de las ventas procesadas por American Express?",
  "¿Cuánto falta por depositarse en la cuenta bancaria de las terminales de Banorte?",
  "¿Qué porcentaje de las ventas totales representan las cuentas por cobrar?",
  "Del efectivo recaudado entre el día 2026-06-01 y el día 2026-06-30, ¿cuánto se requiere para el pago de propinas?",
  "Entre el día 2026-06-01 y el día 2026-06-30, ¿cuál fue el efectivo real recaudado por ventas de la sucursal?",
  "Entre el día 2026-06-01 y el día 2026-06-30, ¿cuánto efectivo correspondiente a cortesías de dirección recaudó la sucursal?",
  "Del dinero depositado en la cuenta bancaria entre el día 2026-06-01 y el día 2026-06-30, ¿cuánto corresponde a propinas y cuánto corresponde a ingresos reales por ventas?",
  "¿Qué porcentaje representan las propinas respecto al total de las ventas del mes de junio?",
  "¿Cuánto del ingreso correspondiente a ventas realizadas con American Express durante junio ya fue depositado en la cuenta bancaria?",
  "¿Cuánto de las ventas procesadas mediante las terminales de Banorte durante junio ya fue depositado en la cuenta bancaria?",
  "Al cierre del mes de junio, ¿cuáles son los depósitos pendientes de recibir en la cuenta bancaria correspondientes a ventas de junio realizadas con American Express?",
  "Al cierre del mes de junio, ¿cuál es el monto total pendiente por depositarse en la cuenta bancaria correspondiente a ventas de junio realizadas mediante las terminales de Banorte?",
  "¿Qué ingresos depositados durante junio corresponden a ventas realizadas en mayo? Indicar el monto y la fecha de cada depósito de Banorte.",
  "¿Cuánto dinero ingresó a la cuenta bancaria durante junio correspondiente a ventas realizadas en mayo mediante American Express?",
  "¿Cuál es el porcentaje de comisión, sin incluir IVA, que cobra la terminal de American Express sobre las ventas procesadas?",
  "¿Cuál fue el monto total de las ventas realizadas a través de Uber durante el mes de junio?",
  "¿Cuál fue el monto total de las ventas realizadas a través de Rappi durante el mes de junio?",
  "¿Cuál fue el monto total de los depósitos recibidos de Uber durante el mes de junio?",
  "¿Cuál fue el monto total de los depósitos recibidos de Rappi durante el mes de junio?",
  "¿Qué porcentaje representan las comisiones cobradas por Uber respecto al total de los depósitos recibidos de dicha plataforma durante el mes de junio?",
  "¿Qué porcentaje representan las comisiones cobradas por Rappi respecto al total de los depósitos recibidos de dicha plataforma durante el mes de junio?",
  "¿Qué porcentaje de las ventas totales del mes de junio corresponde a ventas realizadas a través de Uber?",
  "¿Qué porcentaje de las ventas totales del mes de junio corresponde a ventas realizadas a través de Rappi?",
];

function answerAll(liveContext: typeof context & { closingRun?: typeof context.latestBankRun }) {
  return questions.map((question, index) => ({ number: index + 1, answer: answerFinancialQuestion({ ...liveContext, question }) }));
}

if (process.env.LIVE_FINANCIAL_TEST !== "1") {
  for (const question of questions) assert.ok(answerFinancialQuestion({ ...context, question }), question);
  assert.deepEqual(resolveFinancialPeriod("¿Qué se depositó durante junio por ventas de mayo?", "2026-07", "2026-07-09"), { start: "2026-06-01", end: "2026-06-30", effectiveDate: "2026-07-09" });
  const partialJuly = days.slice(0, 8).map((row, index) => ({ ...row, business_date: `2026-07-${String(index + 1).padStart(2, "0")}` }));
  assert.match(answerFinancialQuestion({ ...context, question: "Al cierre de julio, ¿cuánto quedó pendiente de American Express?", periodStart: "2026-07-01", periodEnd: "2026-07-31", dailyRecords: partialJuly }), /Todavía no puedo dar el cierre/);
  console.log(`OK: ${questions.length} preguntas y resolución de período`);
} else {
  const live = JSON.parse(readFileSync(0, "utf8"));
  const asArray = (value: unknown) => Array.isArray(value) ? value : ((value as { value?: unknown[] } | null)?.value ?? []);
  const bankRuns = asArray(live.bankRuns) as typeof context.bankRuns;
  console.log(JSON.stringify(answerAll({ ...context, dailyRecords: asArray(live.dailyRecords), receivables: asArray(live.receivables), bankRuns, latestBankRun: bankRuns[0] ?? null })));
}
