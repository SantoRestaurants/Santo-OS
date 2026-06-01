# ADR-0008: XML SAT Thin Local Validation

Date: 2026-05-27

## Status

Accepted.

## Context

P0 includes XML SAT validation only as a secondary thin workflow. RFC mappings, Drive folders and real anonymized MiAdminXML fixtures are still pending. Safety boundaries prohibit SAT/FIEL/government-portal automation.

## Decision

Implement XML SAT validation as local XML metadata validation:

- Parse provided XML text locally.
- Extract CFDI metadata when present.
- Reject unsafe XML declarations such as DOCTYPE/entity.
- Validate RFCs only against provided config.
- Return `requires_review` when config or XML text is missing.
- Produce workflow_run, document, task, exception, event and watchdog records.

No SAT portal, FIEL, filing or fiscal response automation is included.

## Consequences

- The secondary XML workflow reuses the workflow module contract.
- Fiscal safety boundaries remain intact.
- Full validation quality still depends on Santo providing confirmed RFC mappings and real anonymized/sanitized export fixtures.
