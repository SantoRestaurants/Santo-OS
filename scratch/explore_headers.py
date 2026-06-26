import openpyxl, json
files = [
    '01. Santo_Ingresos Enero 2026.xlsx',
    '05. Santo_Ingresos Mayo 2026.xlsx', 
    '06. Santo_Ingresos Junio 2026.xlsx'
]
for f in files:
    wb = openpyxl.load_workbook(f'C:/Users/dchac/OneDrive/Desktop/santo/{f}', data_only=True)
    ws = wb.active
    print(f'--- {f} ---')
    print(json.dumps([[c.value for c in r] for r in ws.iter_rows(min_row=1, max_row=5)], default=str))
