from __future__ import annotations

import importlib.util
from pathlib import Path


MODULE = Path(__file__).resolve().parents[1] / "evidence_builder.py"
SPEC = importlib.util.spec_from_file_location("evidence_builder", MODULE)
assert SPEC is not None and SPEC.loader is not None
evidence_builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence_builder)


def test_builds_income_values_using_pdf_rules() -> None:
    terminal = {
        "amex": {"consumo": 8778.0, "propina": 1131.45},
        "bancos": {"consumo": 51741.0, "propina": 5451.15},
        "efectivo": {"consumo": 5058.5, "propina": 0.0},
        "plataformas": {"consumo": 3525.0, "propina": 0.0},
    }
    sistema = {
        "amex": {"consumo": 8778.0, "propina": 1131.45},
        "bancos": {"consumo": 51741.0, "propina": 5451.15},
        "efectivo": {"consumo": 5058.5, "propina": 0.0},
    }
    vision = [
        {
            "document_type": "tira",
            "status": "extracted",
            "values": {"propina_total": 6700.0},
        },
        {
            "document_type": "amex",
            "status": "extracted",
            "values": {"consumo": 8778.0, "propina": 1131.45, "total": 9909.45},
        },
        {
            "document_type": "bancarias",
            "status": "extracted",
            "values": {
                "consumo_debito": 4810.0,
                "propina_debito": 320.25,
                "consumo_credito": 46931.0,
                "propina_credito": 5130.9,
                "total": 57192.15,
            },
        },
        {
            "document_type": "detalle_efectivo",
            "status": "extracted",
            "values": {"cortesia_direccion": 80.0},
        },
    ]

    result = evidence_builder.build_canonical_evidence(
        terminal,
        sistema,
        vision_documents=vision,
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert result["status"] == "ready"
    assert result["selected_tips"] == 6582.6
    assert result["income_register"]["efectivo"] == 5138.5
    assert result["income_register"]["amex"] == 9909.45
    assert result["income_register"]["debito"] == 5130.25
    assert result["income_register"]["credito"] == 52061.9


def test_photo_total_mismatch_requires_review() -> None:
    result = evidence_builder.build_canonical_evidence(
        {"amex": {"consumo": 100.0, "propina": 10.0}},
        {"amex": {"consumo": 100.0, "propina": 10.0}},
        vision_documents=[
            {
                "document_type": "amex",
                "status": "extracted",
                "values": {"total": 109.0},
            }
        ],
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert result["status"] == "requires_review"
    assert result["exceptions"][0]["exception_key"] == "amex_photo_vs_excel_discrepancy"
