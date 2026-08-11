# -*- coding: utf-8 -*-
import sys, json, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, r'C:\Users\ARHAMS~1\AppData\Local\Temp\claude\D--dev-projects-tests-sarvaamAPI\74bd9344-85e9-4dad-a58d-765d13935ea3\scratchpad\uroman\uroman')
import uroman as ur
u = ur.Uroman()

with open(r'C:\Users\ARHAMS~1\AppData\Local\Temp\claude\D--dev-projects-tests-sarvaamAPI\74bd9344-85e9-4dad-a58d-765d13935ea3\scratchpad\uroman_golden_fixtures.json', encoding='utf-8') as f:
    fixtures = json.load(f)

BRAHMIC = {"Devanagari","Bengali","Gurmukhi","Gujarati","Oriya","Tamil","Telugu","Kannada","Malayalam"}

out = []
for fx in fixtures:
    if fx["script"] not in BRAHMIC:
        continue
    words = re.findall(r"[^\s]+", fx["input"])
    for w in words:
        clean = re.sub(r"[।.,!?॥]+$", "", w)  # strip trailing danda/punct like our pipeline will
        if not clean:
            continue
        rom = u.romanize_string(clean, lcode=fx["lcode"])
        out.append({"lang": fx["lang"], "lcode": fx["lcode"], "script": fx["script"], "word": clean, "uroman": rom})

with open(r'C:\Users\ARHAMS~1\AppData\Local\Temp\claude\D--dev-projects-tests-sarvaamAPI\74bd9344-85e9-4dad-a58d-765d13935ea3\scratchpad\perword_fixtures.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", len(out), "per-word fixtures")
