# Utilities Workflow Index

## Purpose

Thin P0 workflow for registering utility receipt metadata and documents for
human review. It covers CFE, water and gas style receipt intake without making
payments or contacting provider portals.

## Load First

1. `skill.md` - scope, input/output contract and safety boundary.
2. `config.example.json` - accepted providers and pending configuration.
3. `script.py` - primary workflow entry point.
4. `fixtures/` and `tests/` - expected registration and review scenarios.

## Notes

This module must not execute payments. Missing receipt metadata or unconfirmed
provider configuration returns `requires_review`.
