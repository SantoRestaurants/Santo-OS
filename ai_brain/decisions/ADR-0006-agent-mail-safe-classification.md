# ADR-0006: Agent Mail Safe Classification

Date: 2026-05-27

## Status

Accepted.

## Context

P0 requires Agent Mail as a controlled intake and notification channel. The final routing convention is pending and must not be guessed. The technical spec prefers subject prefixes, labels and sender rules as configurable signals.

## Decision

Implement Agent Mail intake as an offline core first:

- Accept structured email metadata.
- Build an `email_messages`-shaped record.
- Classify only when routing config is confirmed.
- Use confirmed subject prefixes as the first supported routing rule.
- Return `requires_review` for missing config, ambiguous prefixes or unclassified email.
- Produce a command handler envelope only for confirmed classification.
- Allow `ignored` only through confirmed ignored-prefix rules.

No live polling or Gmail integration is included yet.

## Consequences

- Agent Mail can be tested safely without mailbox credentials.
- Routing remains configurable and auditable.
- Ambiguous emails stay in the review path instead of being guessed.
