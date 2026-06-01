# P0 Safety Boundaries

Santo AI OS may prepare, draft, classify, summarize, validate and recommend.

It must not autonomously execute high-risk actions.

## Never Autonomous

- Bank payments.
- Payroll payments.
- SAT filings.
- DIOT submissions.
- IDSE movements.
- IMSS actions.
- FIEL actions.
- Fiscal responses.
- Legal filings.
- Legal or compliance submissions.
- Bank portal actions.
- Payroll dispersions.
- Government portal submissions.

## P0 Safety Defaults

- Supabase/Postgres is the source of truth.
- Agent Mail is a communication and intake channel, not truth.
- Claude/AI is reasoning and drafting, not approval truth.
- Ambiguous workflow state becomes `requires_review`.
- Missing configuration never passes silently.
- Humans review high-risk or ambiguous outputs.
