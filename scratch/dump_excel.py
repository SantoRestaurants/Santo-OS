import openpyxl
import json

def inspect_excel():
    wb = openpyxl.load_workbook('C:/Users/dchac/OneDrive/Desktop/santo/01. Santo_Ingresos Enero 2026.xlsx', data_only=True)
    ws = wb.active
    rows = []
    for row in ws.iter_rows(min_row=1, max_row=40, values_only=True):
        rows.append(row)
    
    with open('C:/Users/dchac/Documents/Codex/SantoOS/scratch/excel_dump.json', 'w') as f:
        json.dump(rows, f, indent=2, default=str)

if __name__ == '__main__':
    inspect_excel()
