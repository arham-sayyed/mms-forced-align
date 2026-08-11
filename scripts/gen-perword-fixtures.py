# -*- coding: utf-8 -*-
import json, re, os
import uroman as ur

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.chdir("..")

u = ur.Uroman()

with open("test/fixtures/romanize/golden-sentences.json", encoding="utf-8") as f:
    fixtures = json.load(f)

BRAHMIC = {"Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam"}

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

with open("test/fixtures/romanize/golden-words.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", len(out), "per-word fixtures")
