# -*- coding: utf-8 -*-
import sys, json, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import uroman as ur
u = ur.Uroman()

with open("test/fixtures/romanize/golden-sentences.json", encoding="utf-8") as f:
    fixtures = json.load(f)

out = []
for fx in fixtures:
    if fx["script"] != "Perso-Arabic":
        continue
    words = re.findall(r"[^\s]+", fx["input"])
    for w in words:
        clean = re.sub(r"[،؛؟.]+$", "", w)
        if not clean:
            continue
        rom = u.romanize_string(clean, lcode=fx["lcode"])
        out.append({"lang": fx["lang"], "lcode": fx["lcode"], "word": clean, "uroman": rom})

with open("test/fixtures/romanize/golden-words-arabic.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", len(out), "fixtures")
