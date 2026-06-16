# ADR-0011: Corte Santo Vision Extraction and Bank Statement Ingestion

Date: 2026-06-12

## Status

Accepted (foundational components). Builds on ADR-0009/0010.

## Context

A real corte (test set for 2026-06-04) arrives as a mix of:

- Structured: corte Excel (Cierre Ter/Pla + Cierre Sistema), Banorte statement
  CSV, AMEX statement (.xls), monthly income workbook, monthly forecast workbook.
- Images: terminal "tira" photo, bank terminal batch-close photos, hand-written
  cash detail photo.

Per the workflow owner, the images are central to reconciliation: the grand
totals on the photos are compared against the Excel, and the tip taken is the
*lower* of the tira photo vs the bank photos; cash tip adds dish courtesies.
Bank rules: "REST SANTO" => Banorte settlement; SPEI from AMERICAN EXPRESS =>
AMEX; UBR PAGOS/UBER => Uber; domiciled charges (Spotify, credit card, internet,
"domiciliacion") => additional expenses; CXC = accounts receivable. After
reconciliation, the system must also write into the income and forecast
workbooks (forecast uses SUBTOTALES; Thursdays load Thu–Sun goals).

The system (not the developer) must perform this for every corte. The runtime
has `openpyxl` and `httpx` but no `xlrd` and no vision SDK/API key.

## Decision

1. **Vision extraction is a configured model call, not hardcoded OCR.** Added
   `workflows/corte_santo/vision_extractor.py`: sends each corte image to a
   configured vision model (Anthropic Messages API shape via httpx, no SDK) with
   a strict per-document JSON schema and a confidence score. Provider, endpoint,
   model and API-key env var come from `config.vision_extraction`.
2. **Confidence gate.** If the API key is missing, the call fails, the response
   is unparseable, or confidence is below the confirmed threshold (default
   0.95), the document is returned as `requires_review`. Money is never invented
   and uncertainty never becomes a completed value — critical because these
   numbers feed a zero-tolerance reconciliation and get written into the
   client's books.
3. **Bank statement parser.** Added `bank_statement_parser.py` implementing the
   owner's keyword rules (config-driven via `bank_keywords`) to classify Banorte
   deposits by source and capture domiciled expenses. Unclassified deposits =>
   `requires_review`. Verified against the real 2026-06-04 Banorte CSV
   (Banorte 378,467.32 / Uber 15,543.82 / AMEX 113,230.36, 0 unclassified).
4. Config example extended with `vision_extraction` and `bank_keywords`.

## Consequences

- The hard, judgment-bearing inputs (photos) now have a real, safe ingestion
  path that degrades to human review instead of guessing.
- New operational inputs required from Santo to go live: a vision model + API
  key (`CORTE_VISION_API_KEY`), confirmation of the exact corte Excel headers,
  and confirmation of the income/forecast workbook layout for write-back.
- Still to build (next phases, each with tests):
  - AMEX `.xls` reader (needs `xlrd` or conversion to `.xlsx`).
  - The cross-validation logic (photo grand total vs Excel; lower-tip rule;
    cash tip + dish courtesy) wired into reconcile.
  - Write-back into the income workbook and the forecast workbook (incl.
    SUBTOTALES range extension and the Thursday Thu–Sun rule).
  - Hoja-2 "no deposits" consistency check on the bank download.
- AI continues to only extract/validate/draft; it performs no bank/SAT/payroll/
  portal actions and writes to workbooks only after reconciliation, with review
  on any uncertainty.
