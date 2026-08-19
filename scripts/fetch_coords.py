import json
from urllib.request import Request, urlopen

req = Request('https://raw.githubusercontent.com/albertyw/avenews/master/old/data/average-latitude-longitude-countries.csv', headers={'User-Agent': 'Mozilla/5.0'})
lines = urlopen(req).read().decode('utf-8').splitlines()[1:]
coords = {}
for line in lines:
    parts = [p.strip('\"') for p in line.split(',')]
    if len(parts) >= 4:
        country = parts[1]
        lat = parts[2]
        lon = parts[3]
        try:
            coords[country] = [float(lat), float(lon)]
            if parts[0]:
               coords[parts[0]] = [float(lat), float(lon)] # Add ISO 2 code too
        except ValueError:
            pass

# Add some custom mappings if needed
coords['Unknown'] = [0, 0]
coords['Unknown Location'] = [0, 0]

from pathlib import Path
out_file = Path(__file__).parent.parent / "src" / "dashboard" / "country_coords.js"
with open(out_file, 'w', encoding='utf-8') as f:
    f.write('const COUNTRY_COORDS = ' + json.dumps(coords, indent=2) + ';\n')
