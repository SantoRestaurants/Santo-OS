#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Scenarios configurations mapping
SCENARIOS = {
    "corte_santo": {
        "name": "Corte Santo - Daily Sales Reconciliation",
        "folder": "corte_santo",
        "script": "script.py",
        "scenarios": {
            "scenario_1_ok": {
                "name": "Reconciliación Exitosa (Todo OK)",
                "description": "Ventas coinciden perfectamente con efectivo y depósito bancario. No hay descuadres.",
                "file": "scenario_1_ok.json"
            },
            "scenario_2_cash_discrepancy": {
                "name": "Descuadre de Caja (Severidad Media)",
                "description": "Diferencia de caja de $80. Como la tolerancia es de $0, esto genera excepción.",
                "file": "scenario_2_cash_discrepancy.json"
            },
            "scenario_3_high_deposit_discrepancy": {
                "name": "Descuadre de Depósito (Severidad Alta)",
                "description": "Diferencia de depósito bancario de $400. Al ser la tolerancia de $0, genera excepción de severidad alta.",
                "file": "scenario_3_high_deposit_discrepancy.json"
            },
            "scenario_4_missing_documents": {
                "name": "Falta Reporte de Ventas (Intake bloqueado)",
                "description": "Falta el archivo adjunto obligatorio del corte de ventas diario.",
                "file": "scenario_4_missing_documents.json"
            }
        }
    },
    "xml_sat": {
        "name": "Validación XML SAT (Facturas)",
        "folder": "xml_sat_validation",
        "script": "script.py",
        "scenarios": {
            "scenario_1_ok": {
                "name": "Factura Válida (Todo OK)",
                "description": "El XML parsea correctamente y los RFCs están en la lista de permitidos.",
                "file": "scenario_1_ok.json"
            },
            "scenario_2_rfc_mismatch": {
                "name": "RFC no Permitido (Revisión)",
                "description": "El emisor del XML no está registrado en la lista de proveedores permitidos.",
                "file": "scenario_2_rfc_mismatch.json"
            },
            "scenario_3_malicious_xml": {
                "name": "XML Inseguro (Rechazado)",
                "description": "XML contiene una declaración DOCTYPE externa prohibida (seguridad).",
                "file": "scenario_3_malicious_xml.json"
            }
        }
    },
    "utilities": {
        "name": "Recibos de Servicios (Utilidades)",
        "folder": "utilities",
        "script": "script.py",
        "scenarios": {
            "scenario_1_ok": {
                "name": "Recibo CFE Válido (Todo OK)",
                "description": "Recibo de luz de CFE con monto, fecha de vencimiento y número de servicio válido.",
                "file": "scenario_1_ok.json"
            },
            "scenario_2_invalid_provider": {
                "name": "Proveedor No Soportado (Revisión)",
                "description": "Se ingresa un recibo de Internet (Telmex), no soportado en P0.",
                "file": "scenario_2_invalid_provider.json"
            },
            "scenario_3_missing_fields": {
                "name": "Falta Número de Servicio (Revisión)",
                "description": "Se ingresa un recibo de agua sin el número de servicio obligatorio.",
                "file": "scenario_3_missing_fields.json"
            }
        }
    }
}

def print_banner(text):
    print("\n" + "=" * 80)
    print(f" {text}")
    print("=" * 80)

def main():
    parser = argparse.ArgumentParser(description="Ejecutor de Escenarios Sintéticos de SantoOS")
    parser.add_argument("--workflow", choices=["corte_santo", "xml_sat", "utilities"], help="Nombre del workflow")
    parser.add_argument("--scenario", help="ID del escenario a ejecutar")
    args = parser.parse_args()

    root_dir = Path(__file__).resolve().parent

    # Interactive flow if arguments are not provided
    selected_wf = args.workflow
    selected_sc = args.scenario

    if not selected_wf:
        print_banner("SANTO AI OS - SIMULADOR DE WORKFLOWS")
        print("Selecciona un workflow para simular:")
        wf_keys = list(SCENARIOS.keys())
        for idx, key in enumerate(wf_keys, 1):
            print(f"  [{idx}] {SCENARIOS[key]['name']}")
            print(f"      {SCENARIOS[key]['description']}")

        try:
            choice = int(input("\nSelección (número): ").strip())
            if 1 <= choice <= len(wf_keys):
                selected_wf = wf_keys[choice - 1]
            else:
                print("Selección inválida. Saliendo.")
                return 1
        except (ValueError, IndexError):
            print("Selección inválida. Saliendo.")
            return 1

    wf_info = SCENARIOS[selected_wf]
    scenarios_map = wf_info["scenarios"]

    if not selected_sc:
        print_banner(f"ESCENARIOS DISPONIBLES: {wf_info['name']}")
        sc_keys = list(scenarios_map.keys())
        for idx, key in enumerate(sc_keys, 1):
            print(f"  [{idx}] {scenarios_map[key]['name']}")
            print(f"      Descripción: {scenarios_map[key]['description']}")

        try:
            choice = int(input("\nSelecciona escenario (número): ").strip())
            if 1 <= choice <= len(sc_keys):
                selected_sc = sc_keys[choice - 1]
            else:
                print("Selección inválida. Saliendo.")
                return 1
        except (ValueError, IndexError):
            print("Selección inválida. Saliendo.")
            return 1

    if selected_sc not in scenarios_map:
        print(f"Error: Escenario '{selected_sc}' no encontrado para '{selected_wf}'.")
        return 1

    sc_info = scenarios_map[selected_sc]
    folder_path = root_dir / "workflows" / wf_info["folder"]
    script_path = folder_path / wf_info["script"]
    input_path = folder_path / "fixtures" / sc_info["file"]
    config_path = folder_path / "fixtures" / "config_confirmed.json"

    print_banner(f"EJECUTANDO: {sc_info['name']}")
    print(f"Workflow: {selected_wf} ({wf_info['name']})")
    print(f"Escenario: {selected_sc}")
    print(f"Descripción: {sc_info['description']}")
    print("-" * 80)
    print(f"Script:    workflows/{wf_info['folder']}/{wf_info['script']}")
    print(f"Entrada:   workflows/{wf_info['folder']}/fixtures/{sc_info['file']}")
    print(f"Config:    workflows/{wf_info['folder']}/fixtures/config_confirmed.json")
    print("-" * 80)

    # Validate file existences
    if not script_path.exists():
        print(f"Error: No se encontró el script en {script_path}")
        return 1
    if not input_path.exists():
        print(f"Error: No se encontró la entrada en {input_path}")
        return 1
    if not config_path.exists():
        print(f"Error: No se encontró el archivo de configuración en {config_path}")
        return 1

    # Execute
    cmd = [
        sys.executable,
        str(script_path),
        "--input", str(input_path),
        "--config", str(config_path)
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        result_json = json.loads(res.stdout)

        # Pretty print results
        print("\n>>> SALIDA DEL SCRIPT DE PYTHON (ESTADO RESUMIDO) <<<")
        print(f"Estatus General:        {result_json.get('status')}")
        print(f"Idempotency Key:        {result_json.get('idempotency_key')}")

        run_info = result_json.get("workflow_run", {})
        print(f"Run Estatus:            {run_info.get('status')}")
        if run_info.get("requires_review_reason"):
            print(f"Razón de Revisión:      {run_info.get('requires_review_reason')}")

        print("\nTareas Creadas:")
        for t in result_json.get("tasks", []):
            print(f"  - [{t.get('status').upper()}] {t.get('title')} (key: {t.get('task_key')})")

        print("\nExcepciones Generadas:")
        exceptions = result_json.get("exceptions", [])
        if not exceptions:
            print("  Ninguna (Todo OK)")
        for exc in exceptions:
            print(f"  - [{exc.get('severity').upper()}] {exc.get('exception_key')} ({exc.get('exception_type')})")
            print(f"    Detalles: {json.dumps(exc.get('details'))}")

        print("\nDocumentos Procesados:")
        for doc in result_json.get("documents", []):
            print(f"  - {doc.get('document_key')}: Estatus={doc.get('status')}, Tipo={doc.get('document_type')}")

        print("\nLogs del Watchdog:")
        for w in result_json.get("watchdog_log", []):
            print(f"  - [{w.get('status').upper()}] {w.get('check_key')}: {w.get('message')}")

        # Prompt if they want to see raw JSON output
        view_raw = input("\n¿Deseas ver el JSON de salida completo? (s/n): ").strip().lower()
        if view_raw == "s":
            print_banner("JSON DE SALIDA COMPLETO")
            print(json.dumps(result_json, indent=2, ensure_ascii=False))

    except subprocess.CalledProcessError as e:
        print("\n[ERROR DE EJECUCIÓN]")
        print("El script de Python falló al ejecutarse:")
        print(e.stderr)
        return 1
    except Exception as e:
        print(f"\n[ERROR INTERNO]: {e}")
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
