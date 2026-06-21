# ADR-0015: Workflow Skill Markdown Frontmatter

Date: 2026-06-21

## Status

Accepted

## Context

Santo requested a lightweight documentation convention for P0 workflow modules
inspired by Google's Open Knowledge format. The request does not change P0
scope, milestones, runtime behavior or operational rules.

## Decision

Every workflow `skill.md` should begin with YAML frontmatter containing:

- `type`
- `title`
- `description`
- `resource`
- `tags`
- `timestamp`

Workflow folders may also include:

- `index.md` for module purpose and recommended load order.
- `log.md` for notable module documentation or behavior changes.

The P0 workflow modules and the workflow template now follow this convention.

## Consequences

Human readers, Claude and other agents can discover and load workflow context
more consistently. The metadata is documentation only and must not become a
runtime source of truth for workflow state, approvals, audit trails or config.
