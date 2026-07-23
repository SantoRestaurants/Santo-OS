import assert from "node:assert/strict";

import { bankValidationState, getOutstandingForDate } from "./corte-dashboard-utils";

const priorBankSnapshot = {
  business_date: "2026-07-11",
  created_at: "2026-07-12T03:00:00Z",
  status: "completed",
  output_payload: {
    bank_processing_snapshot: {
      processed_on: "2026-07-11",
      processed_dates: ["2026-07-11"],
    },
    falta_por_entrar_por_dia: { "2026-07-11": 46358.17 },
    bank_reconciliation: {
      pending_collections: { amex: 36358.17, banorte: 10000 },
      pending_items: [
        { business_date: "2026-07-11", channel: "banorte", amount: 10000 },
      ],
    },
  },
};

const groupedBankSnapshot = {
  business_date: "2026-07-13",
  created_at: "2026-07-14T03:00:00Z",
  status: "completed",
  output_payload: {
    bank_processing_snapshot: {
      processed_on: "2026-07-13",
      processed_dates: ["2026-07-11", "2026-07-12"],
    },
    falta_por_entrar_por_dia: {
      "2026-07-11": 46358.17,
      "2026-07-12": 46358.17,
    },
    bank_reconciliation: {
      pending_collections: { amex: 36358.17, banorte: 10000 },
      pending_items: [
        { business_date: "2026-07-11", channel: "banorte", amount: 10000 },
      ],
    },
  },
};

const onTheDaySnapshot = {
  business_date: "2026-07-12",
  created_at: "2026-07-13T03:00:00Z",
  status: "completed",
  output_payload: {
    bank_processing_snapshot: {
      processed_on: "2026-07-12",
      processed_dates: ["2026-07-11", "2026-07-12"],
    },
    falta_por_entrar_por_dia: {
      "2026-07-11": 46358.17,
      "2026-07-12": 36358.17,
    },
    bank_reconciliation: {
      pending_collections: { amex: 36358.17 },
      pending_items: [],
    },
  },
};

const batchedOnlySnapshot = {
  business_date: "2026-07-15",
  created_at: "2026-07-16T03:00:00Z",
  status: "completed",
  output_payload: {
    bank_processing_snapshot: {
      processed_on: "2026-07-15",
      processed_dates: ["2026-07-13", "2026-07-14"],
    },
    falta_por_entrar_por_dia: {
      "2026-07-13": 4000,
      "2026-07-14": 0,
    },
    bank_reconciliation: {
      pending_collections: {},
      pending_items: [],
    },
  },
};

const weekendSnapshot = {
  business_date: "2026-07-20",
  created_at: "2026-07-21T03:00:00Z",
  status: "completed",
  output_payload: {
    bank_processing_snapshot: {
      processed_on: "2026-07-20",
      processed_dates: ["2026-07-17", "2026-07-18", "2026-07-19"],
      falta_por_entrar_detalle_por_dia: {
        "2026-07-17": { amex: 500, banorte: 300 },
        "2026-07-18": { amex: 500, banorte: 300 },
        "2026-07-19": { amex: 500, banorte: 300 },
      },
    },
    falta_por_entrar_por_dia: {
      "2026-07-17": 800,
      "2026-07-18": 800,
      "2026-07-19": 800,
    },
    falta_por_entrar_detalle_por_dia: {
      "2026-07-17": { amex: 500, banorte: 300 },
      "2026-07-18": { amex: 500, banorte: 300 },
      "2026-07-19": { amex: 500, banorte: 300 },
    },
    bank_reconciliation: {
      pending_collections: { amex: 500, banorte: 300 },
      pending_items: [],
    },
  },
};

const sameDayFirstSnapshot = {
  business_date: "2026-07-21",
  created_at: "2026-07-22T01:00:00Z",
  status: "completed",
  output_payload: {
    bank_processing_snapshot: {
      processed_on: "2026-07-21",
      processed_dates: ["2026-07-21"],
    },
    falta_por_entrar_por_dia: { "2026-07-21": 900 },
    bank_reconciliation: {
      pending_collections: { amex: 900 },
      pending_items: [],
    },
  },
};

const sameDayLaterSnapshot = {
  ...sameDayFirstSnapshot,
  created_at: "2026-07-22T02:00:00Z",
  output_payload: {
    ...sameDayFirstSnapshot.output_payload,
    falta_por_entrar_por_dia: { "2026-07-21": 700 },
    bank_reconciliation: {
      pending_collections: { amex: 700 },
      pending_items: [],
    },
  },
};

const runs = [priorBankSnapshot, groupedBankSnapshot, onTheDaySnapshot, batchedOnlySnapshot] as any;
const noBanksForJuly16 = {
  business_date: "2026-07-16",
  created_at: "2026-07-17T03:00:00Z",
  status: "waiting_for_input",
  output_payload: { bank_validation_status: "bank_pending_upload" },
};

const july11 = getOutstandingForDate(runs, "2026-07-11");
assert.equal(july11?.total, 46358.17);
assert.equal(july11?.processedOn, "2026-07-11");
assert.deepEqual(july11?.entries, [
  { channel: "amex", amount: 36358.17 },
  { channel: "banorte", amount: 10000 },
]);

const july12 = getOutstandingForDate(runs, "2026-07-12");
assert.equal(july12?.total, 36358.17);
assert.equal(july12?.processedOn, "2026-07-12");
assert.deepEqual(july12?.entries, [
  { channel: "amex", amount: 36358.17 },
]);

const july14 = getOutstandingForDate(runs, "2026-07-14");
assert.equal(july14?.total, 0);
assert.equal(july14?.processedOn, "2026-07-15");

assert.equal(getOutstandingForDate(runs, "2026-07-10"), null);
assert.equal(getOutstandingForDate([noBanksForJuly16, ...runs] as any, "2026-07-16"), null);
assert.equal(bankValidationState(noBanksForJuly16 as any), "pending_upload");
assert.equal(bankValidationState(priorBankSnapshot as any), "validated");

const weekendRuns = [weekendSnapshot] as any;
for (const date of ["2026-07-17", "2026-07-18", "2026-07-19"]) {
  const weekendDay = getOutstandingForDate(weekendRuns, date);
  assert.equal(weekendDay?.total, 800);
  assert.deepEqual(weekendDay?.entries, [
    { channel: "amex", amount: 500 },
    { channel: "banorte", amount: 300 },
  ]);
}

const sameDayRuns = [sameDayLaterSnapshot, sameDayFirstSnapshot] as any;
assert.equal(getOutstandingForDate(sameDayRuns, "2026-07-21")?.total, 900);

console.log("OK: histórico diario de falta por entrar");
