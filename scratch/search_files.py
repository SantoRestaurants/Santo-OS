import os

desktop = "C:/Users/dchac/OneDrive/Desktop"
for root, dirs, files in os.walk(desktop):
    for f in files:
        fl = f.lower()
        if 'forecast' in fl or 'presupuesto' in fl or 'meta' in fl:
            print("Found file:", os.path.join(root, f))
