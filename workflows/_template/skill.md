---
type: workflow_skill
title: Workflow Template
description: Base SantoOS workflow module template for creating registry-connected, review-safe workflow skills.
resource: workflows/_template/
tags: [template, workflow, p0, registry]
timestamp: 2026-06-21T00:00:00-06:00
---

# Workflow Template Skill

This is the base template for SantoOS workflow modules.

Use it to scaffold workflow-specific modules that connect to the P0 registry spine.

## Contract

- Accept structured input.
- Support `dry_run`.
- Produce deterministic idempotency keys for the same logical input.
- Return `requires_review` when config is missing.
- Log start/end/failure.
- Never perform high-risk external actions autonomously.
