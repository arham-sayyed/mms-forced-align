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
- `{script}.json` (9 Brahmic scripts) — categories, chars, defaultVowel,
  multiCharOverrides, nuktaChars, scriptChars, virama, vocalicChars,
  vowelSigns.
  - `categories` — Unicode General Category for **every** character in the
    script's block, including ones with no romanization at all (nukta, stress
    signs, some candrabindus). uroman consults a neighbouring character's
    category in rules that fire on exactly those characters, so they have to
    be present.
  - `vocalicChars` / `nuktaChars` — characters whose Unicode *name* contains
    "VOCALIC" / "NUKTA". uroman tests those names directly in
    `add_default_abugida_vowel` and `is_at_end_of_word`, so the name-based
    membership has to travel as data.
  - `scriptChars` — the script-gated subset of `chars` that may take a
    default vowel (as opposed to characters uroman's romanization data
    assigns to no particular script, e.g. `ॐ` -> "om", `।` -> "."). Added in
    Task 14; consulted by `brahmic.ts` in three uroman-fidelity rules that
    fire only for characters that actually belong to the script (e.g.
    `क꣭` (san) -> "kan", not "kana" — the following combining mark isn't a
    scriptChars member, so no default vowel is inserted before it).
- `arabic.json` — Perso-Arabic (Urdu/Kashmiri/Sindhi): `chars` (flat,
  context-free, lcode-independent single-character substitution table) plus
  two small exceptions found during Task 10's verification —
  `multiCharOverrides` (a handful of 2-character sequences that romanize as a
  unit regardless of position in the word) and `startOfWordOverrides` (the
  one sequence, "ای" -> "i", that's position-restricted to start-of-word;
  see the comment above `romanizePersoArabicWord` in `persoArabic.ts` for
  both).
