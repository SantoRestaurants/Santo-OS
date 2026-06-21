---
type: workflow_skill
title: XML SAT Validation
description: Thin P0 fiscal validation workflow for local CFDI/XML metadata extraction and configured RFC checks without SAT portal automation.
resource: workflows/xml_sat_validation/
tags: [p0, xml, sat, fiscal, validation]
timestamp: 2026-06-21T00:00:00-06:00
---

# XML SAT Validation Skill

P0 secondary thin workflow: XML SAT validation.

## Scope

- Parse provided XML content locally.
- Extract UUID, issuer RFC, receiver RFC, total and issue date when present.
- Validate against configured RFC map.
- Produce workflow_run, document, task, exception, event and watchdog records.
- Return `requires_review` when RFC map, folders or trusted fixture/source config is missing.

## Non-Scope

- No SAT portal access.
- No FIEL automation.
- No fiscal filing or government-portal action.
- No autonomous fiscal response.

## Safety

XML validation is local metadata validation only. High-risk fiscal actions require human review.
