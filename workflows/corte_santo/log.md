# Corte Santo Workflow Log

## 2026-06-21

- Bank reconciliation now ignores traced non-operating Banorte deposits configured as `ignore_deposit`, starting with `ABONO DCTO. CARTERA`, instead of treating them as unclassified sales deposits.
- Bank reconciliation now matches consolidated AMEX SPEI deposits against multiple AMEX expected-payment rows with the same expected payment date.
- Reason: the 2026-06-17 bank watcher saw a 7,000,000.00 `ABONO DCTO. CARTERA` movement and a 151,131.91 AMEX consolidated SPEI; the previous parser required review for the former and the previous matcher expected one AMEX row per bank deposit.
- Added workflow-skill YAML frontmatter to `skill.md` for the Google Open Knowledge style documentation convention.
- Added this module `index.md` and `log.md` so humans and Claude can quickly load the right files.
- Reason: client documentation standardization request; no runtime scope or behavior changed.
- Commit/PR: pending at time of edit.
