# Agent Mail

P0 Agent Mail intake core.

Responsibilities:

- Ingest OS inbox messages.
- Store metadata in `email_messages`.
- Classify messages only through confirmed routing rules.
- Link classified messages to `workflow_runs` when appropriate.
- Leave ambiguous messages as `requires_review`.

Pending config:

- Inbox address.
- Routing convention.
- Labels or subject prefixes.
- Sender allow/deny rules.

Current implementation:

- `intake.py` accepts structured email metadata.
- Email metadata is converted into an `email_messages`-shaped record.
- Confirmed subject-prefix rules can classify email into workflow command envelopes.
- Missing or ambiguous routing returns `requires_review`.
- Confirmed ignored prefixes can mark an email as `ignored`.

No live Gmail polling is implemented yet.
