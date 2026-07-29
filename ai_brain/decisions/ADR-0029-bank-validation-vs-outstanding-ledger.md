# ADR-0029: Separate bank validation from outstanding collections

Date: 2026-07-29

## Decision

The bank stage is `bank_validated` when the AMEX and Banorte files were read,
classified and cross-checked successfully. Unmatched expected collections are
stored separately as `pending_collections`, `falta_por_entrar` and
`falta_por_entrar_por_dia`.

Those pending amounts must not change the workflow run to `waiting_for_input`,
`bank_requires_review` or a dashboard label such as “Pendiente de conciliar”.
Missing bank files and genuine parser/execution failures remain distinct
states.

## Consequence

The watcher can catch up older Corte dates from a later bank upload while the
dashboard continues to show the outstanding amounts by day. A future Corte
without its bank pair remains `pending_bank_upload` / “Faltan bancos”.
