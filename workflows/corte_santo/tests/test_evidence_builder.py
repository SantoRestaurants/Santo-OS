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
                "consumo": 51741.0,
                "propina": 5451.15,
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
        income_channels={
            "debito": 5130.25,
            "credito": 52061.9,
            "paypal": 0.0,
            "uber": 3525.0,
            "rappi": 0.0,
        },
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert result["status"] == "ready"
    assert result["selected_tips"] == 6582.6
    assert result["income_register"]["efectivo"] == 5138.5
    assert result["income_register"]["amex"] == 9909.45
    assert result["income_register"]["debito"] == 5130.25
    assert result["income_register"]["credito"] == 52061.9
    assert result["income_register"]["paypal"] == 0.0
    assert result["income_register"]["uber"] == 3525.0
    assert result["income_register"]["rappi"] == 0.0
    assert any(
        check["check_key"] == "bancarias_photo_vs_corte_excel"
        and check["status"] == "ok"
        and check["photo_total"] == 57192.15
        for check in result["checks"]
    )


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


def test_cxc_adjustment_is_checked_against_bancos_difference() -> None:
    result = evidence_builder.build_canonical_evidence(
        {"bancos": {"consumo": 83564.65, "propina": 0.0}},
        {"bancos": {"consumo": 76850.65, "propina": 0.0}},
        vision_documents=[
            {
                "document_type": "cxc",
                "status": "extracted",
                "values": {"monto_total": 6714.0, "canal": "debito"},
            }
        ],
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert any(
        check["check_key"] == "cxc_adjustment_vs_bancos_difference"
        and check["status"] == "ok"
        and check["cxc_total"] == 6714.0
        for check in result["checks"]
    )


def test_ocr_total_candidates_can_match_excel_total() -> None:
    result = evidence_builder.build_canonical_evidence(
        {"amex": {"consumo": 17262.0, "propina": 0.0}},
        {"amex": {"consumo": 17262.0, "propina": 0.0}},
        vision_documents=[
            {
                "document_type": "amex",
                "status": "extracted",
                "values": {
                    "total": 26244.0,
                    "total_candidates": [4271.75, 12990.25, 8982.0],
                },
            }
        ],
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    check = result["checks"][0]
    assert check["photo_total"] == 17262.0
    assert check["status"] == "ok"


def test_cxc_candidate_amounts_match_bancos_difference() -> None:
    result = evidence_builder.build_canonical_evidence(
        {"bancos": {"consumo": 83564.65, "propina": 0.0}},
        {"bancos": {"consumo": 76850.65, "propina": 0.0}},
        vision_documents=[
            {
                "document_type": "cxc",
                "status": "extracted",
                "values": {
                    "monto_total": 82827.99,
                    "monto_candidates": [1695.0, 2750.0, 2269.0, 76113.99],
                    "canal": "debito",
                },
            }
        ],
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    check = next(item for item in result["checks"] if item["check_key"] == "cxc_adjustment_vs_bancos_difference")
    assert check["cxc_total"] == 6714.0
    assert check["status"] == "ok"


def test_cxc_does_not_change_income_register_and_tips_fallback_to_terminal() -> None:
    result = evidence_builder.build_canonical_evidence(
        {
            "amex": {"consumo": 15776.5, "propina": 1485.5},
            "bancos": {"consumo": 74273.5, "propina": 9291.15},
        },
        {
            "amex": {"consumo": 15776.5, "propina": 1485.5},
            "bancos": {"consumo": 67558.5, "propina": 9292.15},
        },
        vision_documents=[
            {
                "document_type": "cxc",
                "status": "extracted",
                "values": {
                    "monto_total": 9050.5,
                    "monto_candidates": [1695.0, 2750.0, 2269.0],
                    "canal": "debito",
                },
            }
        ],
        income_channels={"debito": 10027.51, "credito": 66823.14},
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert result["income_register"]["debito"] == 10027.51
    assert result["income_register"]["propinas"] == 10776.65


def test_excel_courtesy_and_cxc_tip_adjust_income_register() -> None:
    result = evidence_builder.build_canonical_evidence(
        {
            "amex": {"consumo": 472.0, "propina": 70.8},
            "bancos": {"consumo": 69664.0, "propina": 9049.61},
            "efectivo": {"consumo": 3530.0, "propina": 0.0},
        },
        {
            "amex": {"consumo": 472.0, "propina": 70.8},
            "bancos": {"consumo": 67268.0, "propina": 8691.36},
            "efectivo": {"consumo": 3530.0, "propina": 0.0},
        },
        vision_documents=[
            {
                "document_type": "cxc",
                "status": "extracted",
                "values": {
                    "consumo": 2395.0,
                    "propina": 359.25,
                    "monto_total": 2754.25,
                    "canal": "debito",
                },
            }
        ],
        income_channels={"debito": 5969.5, "credito": 69989.86},
        income_adjustments={"cortesia_direccion": 2240.0},
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert result["income_register"]["debito"] == 6328.75
    assert result["income_register"]["efectivo"] == 5770.0
    check = next(item for item in result["checks"] if item["check_key"] == "cxc_adjustment_vs_bancos_difference")
    assert check["status"] == "ok"


def test_cxc_tip_uses_bancos_difference_when_ocr_is_close() -> None:
    result = evidence_builder.build_canonical_evidence(
        {"bancos": {"consumo": 69664.0, "propina": 9049.61}},
        {"bancos": {"consumo": 67268.0, "propina": 8691.36}},
        vision_documents=[
            {
                "document_type": "cxc",
                "status": "extracted",
                "values": {
                    "consumo": 2395.0,
                    "propina": 369.26,
                    "monto_total": 2764.26,
                    "canal": "debito",
                },
            }
        ],
        income_channels={"debito": 5969.5},
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert result["income_register"]["debito"] == 6328.75
    check = next(item for item in result["checks"] if item["check_key"] == "cxc_adjustment_vs_bancos_difference")
    assert check["cxc_total"] == 2754.25
    assert check["status"] == "ok"


def test_cxc_vision_failure_requires_review() -> None:
    result = evidence_builder.build_canonical_evidence(
        {"bancos": {"consumo": 83564.65, "propina": 0.0}},
        {"bancos": {"consumo": 76850.65, "propina": 0.0}},
        vision_documents=[
            {
                "document_type": "cxc",
                "status": "requires_review",
                "review_reason": "vision_extraction_error:HTTPStatusError:429",
                "values": {},
            }
        ],
        config={"evidence_rules": {"evidence_tolerance": 0}},
    )

    assert result["status"] == "requires_review"
    assert result["exceptions"][0]["exception_key"] == "cxc_vision_requires_review"
