from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260527132500_p0_registry_spine.sql"
SQL = MIGRATION.read_text(encoding="utf-8").lower()

REQUIRED_TABLES = {
    "domains",
    "workflows",
    "workflow_runs",
    "documents",
    "tasks",
    "exceptions",
    "reviews",
    "approvals",
    "watchdog_log",
    "events",
    "email_messages",
    "people",
    "vendors",
    "restaurants",
    "legal_entities",
    "drive_folder_map",
}


def test_required_tables_exist() -> None:
    for table in REQUIRED_TABLES:
        assert f"create table public.{table}" in SQL


def test_required_tables_enable_rls() -> None:
    for table in REQUIRED_TABLES:
        assert f"alter table public.{table} enable row level security;" in SQL


def test_authenticated_read_policy_exists_for_each_table() -> None:
    for table in REQUIRED_TABLES:
        assert f"on public.{table} for select to authenticated" in SQL
        assert "using (auth.uid() is not null)" in SQL


def test_idempotency_and_deduplication_constraints_exist() -> None:
    assert "unique (workflow_id, idempotency_key)" in SQL
    assert "unique (provider, provider_message_id)" in SQL
    assert "documents_run_source_hash_unique" in SQL


def test_p0_seed_placeholders_are_explicit() -> None:
    assert "corte_santo_daily_sales_reconciliation" in SQL
    assert "xml_sat_validation" in SQL
    assert "utility_receipts_matching" in SQL
    assert "[confirm]" in SQL
    assert "requires_review" in SQL


def test_no_known_supabase_secret_material_was_written() -> None:
    ignored_parts = {"node_modules", ".next", ".git", ".pytest_cache"}
    repo_text = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in ROOT.rglob("*")
        if path.is_file() and not ignored_parts.intersection(path.parts)
    ).lower()

    jwt_like_tokens = re.findall(
        r"\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b",
        repo_text,
    )
    real_supabase_urls = re.findall(
        r"https://(?!\[confirm\])[a-z0-9]{15,}\.supabase\.co",
        repo_text,
    )

    assert jwt_like_tokens == []
    assert real_supabase_urls == []
    assert "service_role" in repo_text
