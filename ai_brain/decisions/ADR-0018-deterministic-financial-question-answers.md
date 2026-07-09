# ADR-0018: Deterministic financial question answers

## Decision

The Corte financial-question endpoint resolves dates and performs financial
calculations from Supabase records before producing an answer. For a differently
worded or open financial question, an LLM receives compact verified facts to
interpret the request and write the answer; it may not infer a balance, payment,
commission or percentage from raw JSON.

## Rationale

Questions from socios require repeatable, auditable answers. The prior endpoint
passed one reconciliation snapshot and monthly data to a model, including an
invalid `workflow_runs.workflow_key` filter. This could silently omit bank data
or change the requested business date.

## Rules

- Use explicit ranges or the month named in the question; no month is assumed
  from the current date when the UI already supplies a selected month.
- A month-end answer requires every calendar day in its daily-record coverage.
  Otherwise explain that the month has not closed.
- A question about a historical month uses that month for sales and activity,
  but pending-bank balances use the latest known bank snapshot. This answers
  whether the historical month's money has entered by now, which is the
  operational question socios use after month close.
- Where no persisted source-sale to bank-deposit relationship exists, state that
  the deposit cannot yet be verified. Do not estimate platform deposits or fees.

## Consequence

The same rule layer can be reused by Jarvis. Completing every question with a
number still depends on persisting item-level bank deposit provenance for all
channels, especially Banorte, Uber and Rappi.
