# Workflow Template Index

## Purpose

Base template for new SantoOS workflow modules. Use this folder to scaffold
registry-connected workflows that follow the P0 safety, review and idempotency
contracts.

## Load First

1. `skill.md` - baseline module contract.
2. `config.example.json` - example configuration shape.
3. `script.py` - minimal executable workflow skeleton.
4. `fixtures/` and `tests/` - smoke-test expectations.

## Notes

Before creating a new workflow from this template, check the workflow registry
and existing workflow folders for overlap. Extend an existing workflow when it
can cover the requested function.
