# XML SAT Validation Workflow Index

## Purpose

Thin P0 fiscal validation workflow. It parses provided CFDI/XML content locally,
extracts metadata, checks configured RFC expectations and produces registry
records for review.

## Load First

1. `skill.md` - scope and fiscal safety boundary.
2. `config.example.json` - RFC and folder configuration contract.
3. `script.py` - primary workflow entry point.
4. `fixtures/` and `tests/` - expected validation scenarios.

## Notes

This module does not access SAT, FIEL, government portals or fiscal filing
systems. Missing or unconfirmed RFC/source configuration returns
`requires_review`.
