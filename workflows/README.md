# Workflow Modules

Workflow execution lives in Python modules.

Every workflow module must include:

- `skill.md`
- `script.py`
- `config.example.json`
- `fixtures/`
- `tests/`

Every `script.py` must:

- Accept structured input.
- Support `dry_run`.
- Be idempotent.
- Log start/end/failure.
- Return clear output.
- Use `requires_review` when config or business rules are missing.

P0 primary workflow:

- `corte_santo` - Daily Sales Reconciliation for one restaurant/unit first.

P0 secondary thin workflows:

- XML SAT validation.
- Utility receipts matching.
