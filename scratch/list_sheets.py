import openpyxl
files = ['01. Santo_Ingresos Enero 2026.xlsx', '02. Santo_Ingresos Febrero 2026.xlsx', '03. Santo_Ingresos Marzo 2026.xlsx', '04. Santo_Ingresos Abril 2026.xlsx', '05. Santo_Ingresos Mayo 2026.xlsx', '06. Santo_Ingresos Junio 2026.xlsx']
for f in files:
    wb = openpyxl.load_workbook(f'C:/Users/dchac/OneDrive/Desktop/santo/{f}', data_only=True)
    print(f, wb.sheetnames)
