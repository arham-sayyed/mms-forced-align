# Romanization data

Extracted from [isi-nlp/uroman](https://github.com/isi-nlp/uroman) (MIT-ish,
see their LICENSE.txt) via `scripts/extract-uroman-data.py`. This is *data*
(character-to-Latin mappings), not a copy of their code — the romanization
algorithm here (src/romanize/brahmic.ts, src/romanize/persoArabic.ts) is our
own implementation of the relevant subset of their approach, written from
scratch against this data.

To regenerate: `git clone https://github.com/isi-nlp/uroman && python
scripts/extract-uroman-data.py uroman src/romanize/data`.

The installed `uroman` pip package ships the same `uroman/data/` directory, so
`python scripts/extract-uroman-data.py <site-packages> src/romanize/data` works
too and produces byte-identical output (verified in Task 14).

Files:
- `{script}.json` (9 Brahmic scripts) — defaultVowel, virama, vowelSigns,
  chars, categories, multiCharOverrides, vocalicChars, nuktaChars.
  - `categories` — Unicode General Category for **every** character in the
    script's block, including ones with no romanization at all (nukta, stress
    signs, some candrabindus). uroman consults a neighbouring character's
    category in rules that fire on exactly those characters, so they have to
    be present.
  - `vocalicChars` / `nuktaChars` — characters whose Unicode *name* contains
    "VOCALIC" / "NUKTA". uroman tests those names directly in
    `add_default_abugida_vowel` and `is_at_end_of_word`, so the name-based
    membership has to travel as data.
- `arabic.json` — flat char table for Perso-Arabic (Urdu/Kashmiri/Sindhi).
