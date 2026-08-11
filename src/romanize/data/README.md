# Romanization data

Extracted from [isi-nlp/uroman](https://github.com/isi-nlp/uroman) (MIT-ish,
see their LICENSE.txt) via `scripts/extract-uroman-data.py`. This is *data*
(character-to-Latin mappings), not a copy of their code — the romanization
algorithm here (src/romanize/brahmic.ts, src/romanize/persoArabic.ts) is our
own implementation of the relevant subset of their approach, written from
scratch against this data.

To regenerate: `git clone https://github.com/isi-nlp/uroman && python
scripts/extract-uroman-data.py uroman src/romanize/data`.

Files:
- `{script}.json` (9 Brahmic scripts) — defaultVowel, virama, vowelSigns,
  chars, categories (Unicode General Category per char), multiCharOverrides.
- `arabic.json` — flat char table for Perso-Arabic (Urdu/Kashmiri/Sindhi).
