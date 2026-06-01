# ADR-0001: AI Development Memory Lives In Repo

Date: 2026-05-27

## Status

Accepted.

## Context

SantoOS will be a long-running, heavily AI-assisted project. Future Codex and Claude sessions need stable context, current state, build rules and decisions.

Obsidian may be used to browse and edit the Markdown files, but the real second brain for coding must live in the repository so AI agents can read it directly.

## Decision

Use repository Markdown files as the AI development second brain:

- `AGENTS.md` for Codex/general agent instructions.
- `CLAUDE.md` for Claude Code instructions.
- `santo_context.md` for master product/company context.
- `ai_brain/current_state.md` for current implementation state.
- `ai_brain/build_rules.md` for construction rules.
- `ai_brain/session_log.md` for notable agent-session history.
- `ai_brain/decisions/` for architectural decisions.

## Consequences

- New AI sessions can recover context quickly.
- Obsidian becomes optional UI over the same files.
- The repo remains the source of AI build memory.
- These files must be updated when project state or architecture changes.

