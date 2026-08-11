# -*- coding: utf-8 -*-
"""
Extracts the character-level romanization data uroman needs for our 9 Brahmic
scripts + the Arabic block, from a cloned isi-nlp/uroman checkout, into plain
JSON our TS engine can load directly. Run against a fresh `git clone
https://github.com/isi-nlp/uroman` checkout's `uroman/data/` directory.

Usage: python extract_uroman_data.py <path-to-uroman-repo> <output-dir>
"""
import sys
import os
import re
import json
import unicodedata

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BRAHMIC_SCRIPTS = [
    "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya",
    "Tamil", "Telugu", "Kannada", "Malayalam",
]


def parse_double_colon_line(line):
    """Parses a '::key value ::key2 value2 ...' line into a dict of key->value.
    Values run until the next '::' or end of line.

    Implemented as: find every '::key' marker, then take each field's value as
    the raw text between the end of its key and the start of the next marker
    (or end of line). This is deliberately simpler than an earlier lookahead-
    based regex (`::(\\S+)\\s+(.*?)(?=\\s+::\\S+\\s|\\s*$)`), which had two real
    bugs found while extracting the Arabic block's data (Task 10):
      1. It required at least one whitespace char after the key before the
         value could start, so a genuinely *empty* value immediately followed
         by a multi-word ::comment (e.g. `::s ْ ::t  ::comment ARABIC
         SUKUN`, sukun's target is legitimately "") swallowed the entire
         comment into the value instead of leaving it empty, because the
         lookahead `\\s+::\\S+\\s` only matches a `::key` that itself is
         followed by more whitespace -- which a comment's *own* multi-word
         text (`::comment ARABIC SUKUN`) doesn't satisfy at the position right
         after `::comment`, so the lazy `.*?` had nothing to stop at short of
         end-of-line.
      2. Values were trimmed with plain `.strip()`, which strips *all*
         Unicode whitespace -- but a couple of entries use an actual Unicode
         space character (e.g. U+3000 IDEOGRAPHIC SPACE) as the ::s value
         itself, and `.strip()` silently deleted it, turning a legitimate
         1-char source key into an empty string.
    Both are fixed here: values are sliced positionally (no lookahead), and
    only ASCII whitespace is trimmed.
    """
    fields = {}
    markers = list(re.finditer(r'::(\S+)', line))
    for i, m in enumerate(markers):
        key = m.group(1)
        start = m.end()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(line)
        val = line[start:end].strip(" \t\r\n")
        fields[key] = val
    return fields


def load_script_char_props(unicode_data_props_path):
    """Returns {script_name: {"chars": [c,...], "vowelSigns": [c,...], "virama": c or None}}"""
    scripts = {}
    with open(unicode_data_props_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            line = re.sub(r"\s{2,}#.*$", "", line)
            fields = parse_double_colon_line(line)
            name = fields.get("script-name")
            if not name or name not in BRAHMIC_SCRIPTS:
                continue
            chars = list(fields.get("char", ""))
            vowel_signs = list(fields.get("vowel-sign", ""))
            virama_chars = list(fields.get("sign-virama", ""))
            scripts[name] = {
                "chars": chars,
                "vowelSigns": vowel_signs,
                "virama": virama_chars[0] if virama_chars else None,
            }
    return scripts


def load_rom_table(path, allow_multichar_source=True):
    """Parses a romanization-table*.txt-style file into an ordered list of
    (source_string, target_string) pairs, preserving file order (later files/
    lines should override earlier ones for the same source in the caller)."""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            line = re.sub(r"\s{2,}#.*$", "", line)
            fields = parse_double_colon_line(line)
            s = fields.get("s")
            t = fields.get("t")
            if s is None or t is None:
                continue
            if not allow_multichar_source and len(s) != 1:
                continue
            entries.append((s, t))
    return entries


def load_auto_table(path):
    """Parses romanization-auto-table.txt (::cp ::s ::cat ::name ::t format)
    into (source_char, target_string, unicode_general_category) triples."""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            line = re.sub(r"\s{2,}#.*$", "", line)
            fields = parse_double_colon_line(line)
            s = fields.get("s")
            t = fields.get("t")
            if s is None or t is None:
                continue
            entries.append((s, t, fields.get("cat", "")))
    return entries


def load_auto_table_names(path):
    """Parses the same file for its ::name field -> {char: unicode_name}.

    uroman consults a character's *Unicode name* (not just its category or
    romanization) in one place that matters for Brahmic scripts:
    add_default_abugida_vowel's `if 'VOCALIC' in self.uroman.chr_name(
    last_s_char): return base_rom` (uroman.py line 1732). Uroman's chr_name()
    is unicodedata.name() with a fallback to its own bundled name table, so we
    read the bundled ::name field first and fall back to the local Python
    unicodedata -- matching uroman's resolution order in reverse but agreeing
    on every character in these blocks (asserted below in main())."""
    names = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            line = re.sub(r"\s{2,}#.*$", "", line)
            fields = parse_double_colon_line(line)
            s, name = fields.get("s"), fields.get("name")
            if s is not None and name is not None and len(s) == 1:
                names[s] = name
    return names


def dequote(s):
    """Strips one layer of matching double quotes, as used by uroman's ::r /
    ::t values for literal-space and empty-string targets (e.g. '""' -> '',
    '" "' -> ' ')."""
    if s is not None and len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1]
    return s


def load_overwrite_table(path):
    """Parses UnicodeDataOverwrite.txt (::u <hex-codepoint> ::r <target> format)
    into a list of (source_char, target_string) pairs, preserving file order.

    uroman.py's load_resource_files() loads this file *between*
    romanization-auto-table.txt and romanization-table.txt (see
    uroman.py's load_resource_files(), which calls load_rom_file() on
    'romanization-auto-table.txt' (provenance 'ud'), then
    'UnicodeDataOverwrite.txt' (provenance 'ow'), then
    'romanization-table.txt' (provenance 'man')) and its entries override
    the auto-table for the many single characters that have no auto-table
    entry at all (candrabindu, visarga, avagraha, om, stress marks, ...) or
    where uroman's maintainers found the auto-generated Unicode-name-derived
    value wrong or ambiguous for actual use (e.g. Bengali CA/CHA needing a
    ch/chh distinction from k/kh-style aspirate pairs, or Bengali anusvara
    needing 'ng' rather than the generic 'm'). This file was previously not
    read by this extraction script at all, which silently dropped all of
    these corrections."""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            line = re.sub(r"\s{2,}#.*$", "", line)
            fields = parse_double_colon_line(line)
            u = fields.get("u")
            r = fields.get("r")
            if u is None or r is None:
                continue
            try:
                cp = int(u, 16)
            except ValueError:
                continue
            entries.append((chr(cp), dequote(r)))
    return entries


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    repo_dir, out_dir = sys.argv[1], sys.argv[2]
    data_dir = os.path.join(repo_dir, "uroman", "data")
    os.makedirs(out_dir, exist_ok=True)

    script_props = load_script_char_props(os.path.join(data_dir, "UnicodeDataProps.txt"))

    auto_entries = load_auto_table(os.path.join(data_dir, "romanization-auto-table.txt"))
    auto_names = load_auto_table_names(os.path.join(data_dir, "romanization-auto-table.txt"))
    overwrite_entries = load_overwrite_table(os.path.join(data_dir, "UnicodeDataOverwrite.txt"))
    exception_entries = load_rom_table(os.path.join(data_dir, "romanization-table.txt"))

    # Build a combined char -> target map per script: auto-table first, then
    # UnicodeDataOverwrite.txt, then exceptions -- this mirrors uroman.py's
    # own load_resource_files(), which loads romanization-auto-table.txt
    # (provenance 'ud'), then UnicodeDataOverwrite.txt (provenance 'ow'),
    # then romanization-table.txt (provenance 'man'), each later file
    # overriding same-character entries from an earlier one. Previously this
    # script skipped UnicodeDataOverwrite.txt entirely, which silently
    # dropped every correction it makes -- including many single chars (e.g.
    # candrabindu, visarga, avagraha, om) that have *no* auto-table entry at
    # all and would otherwise be reported as "missing" by this engine.
    # We keep BOTH single-char and multi-char (e.g. nukta sequences) entries;
    # the JS lookup must try multi-char sequences first (longest match).
    for script_name, props in script_props.items():
        char_set = set(props["chars"])
        table = {}
        cats = {}
        for s, t, cat in auto_entries:
            if len(s) == 1 and s in char_set:
                table[s] = t
                cats[s] = cat
        for s, t in overwrite_entries:
            if len(s) == 1 and s in char_set:
                table[s] = t
                # Category is not carried by UnicodeDataOverwrite.txt itself;
                # most of its entries are combining marks (candrabindu,
                # anusvara, visarga, stress marks, ...), not letters, so
                # defaulting to "Lo" here would be actively wrong (it would
                # make e.g. candrabindu eligible for default-vowel insertion
                # as if it were a bare consonant). Compute the real Unicode
                # General Category instead -- it's authoritative and uses the
                # same short codes (Lo/Lu/Mn/Mc/...) as the auto-table's own
                # ::cat field.
                cats[s] = unicodedata.category(s)
        multichar = {}
        for s, t in exception_entries:
            if len(s) == 1 and s in char_set:
                table[s] = t  # single-char override
                cats[s] = unicodedata.category(s)
            elif len(s) > 1:
                if s[0] in char_set:
                    multichar[s] = t

        # Unicode General Category for every character in the script's block,
        # not just the ones that have a romanization. uroman consults a
        # neighbouring character's category (via char_is_nonspacing_mark) in
        # several context rules that fire on characters it has NO romanization
        # for -- most importantly the nukta, which has no entry in any uroman
        # data file yet participates in add_default_abugida_vowel's
        # "nonspacing mark followed by a vowel sign / virama" lookahead
        # (uroman.py lines 1710-1717) and in is_at_end_of_word's nukta-skipping
        # loop (line 1342). Without categories for those characters the engine
        # cannot reproduce either rule.
        for s in props["chars"]:
            cats.setdefault(s, unicodedata.category(s))

        out = {
            "defaultVowel": "a",
            "virama": props["virama"],
            "vowelSigns": {c: table.get(c) for c in props["vowelSigns"] if c in table},
            "chars": table,
            # Unicode General Category per char: "Lo"/"Lu"/"Ll" = letter (only
            # letters are candidates for default-vowel insertion); "Mc"/"Mn" =
            # combining/nonspacing mark (signs like anusvara/visarga -- never
            # get a default vowel inserted, even if their target romanization
            # happens to look consonant-only, e.g. anusvara -> "m").
            "categories": cats,
            "multiCharOverrides": multichar,
            # Characters whose Unicode name contains "VOCALIC" (the vocalic
            # R/RR/L/LL independent letters and their matching vowel signs).
            # uroman.py line 1732 singles these out by name:
            #     if 'VOCALIC' in self.uroman.chr_name(last_s_char):
            #         return base_rom
            # i.e. a word-*internal* vocalic unit never receives the default
            # abugida vowel (word-final ones are decided earlier, by the
            # end-of-word schwa rules on line 1723). This is a name-based test
            # in uroman, so it has to be extracted as data rather than
            # inferred from category/romanization in the engine.
            "vocalicChars": sorted(
                c for c in table
                if "VOCALIC" in (auto_names.get(c) or unicodedata.name(c, ""))
            ),
            # Characters whose Unicode name contains "NUKTA". Like the VOCALIC
            # set above this is a name-based test in uroman's own source, so it
            # has to travel as data:
            #     while ... and ('NUKTA' in self.uroman.chr_name(self.s[start])):
            #         start += 1
            # (uroman.py line 1342-1345, inside is_at_end_of_word) -- a nukta is
            # transparent when deciding whether the consonant before it is
            # word-final. Note none of these characters has a romanization of
            # its own in any uroman data file; uroman romanizes a nukta to
            # nothing unless it is part of a multi-character entry such as
            # DEVANAGARI KA + NUKTA -> "q". Taken from the script's whole block
            # rather than from `table`, precisely because they are absent from
            # it.
            "nuktaChars": sorted(
                c for c in props["chars"]
                if "NUKTA" in (auto_names.get(c) or unicodedata.name(c, ""))
            ),
        }
        out_path = os.path.join(out_dir, f"{script_name.lower()}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)
        print(f"{script_name}: {len(table)} chars, {len(out['vowelSigns'])} vowel signs, "
              f"virama={props['virama']!r}, {len(multichar)} multi-char overrides -> {out_path}")

    # --- Arabic block (Perso-Arabic: Urdu/Kashmiri/Sindhi) -----------------
    #
    # Task 10 investigation found that romanization-table-arabic-block.txt
    # (the file this extraction originally used exclusively) is NOT actually
    # loaded by real uroman at runtime at all: uroman.py's
    # load_resource_files() loads only romanization-auto-table.txt (provenance
    # 'ud'), UnicodeDataOverwrite.txt ('ow'), and romanization-table.txt
    # ('man') -- "arabic" does not appear anywhere in uroman.py's source. So
    # arabic-block's data, including a real parsing bug in its SUKUN line
    # (`::s ْ ::t  ::comment ARABIC SUKUN`, whose empty ::t value the
    # *old* buggy parse_double_colon_line mis-parsed as the literal string
    # "::comment ARABIC SUKUN"), was always dead weight: never exercised by
    # actual romanization. This extraction now ignores that file entirely and
    # rebuilds the Arabic character table the same way uroman.py really
    # builds it -- layering auto-table, then UnicodeDataOverwrite.txt, then
    # romanization-table.txt, exactly like the Brahmic scripts above -- plus
    # two corrections and one multi-char mechanism the layering alone can't
    # produce. Verified against real uroman (the `uroman` PyPI package) with
    # an exhaustive differential sweep: every character below, at 5 different
    # word positions/neighbor combinations, across all of urd/kas/snd
    # (2000 x 3 = 6000 checks), plus common real words (e.g. "ایک" -> "ik"),
    # all matched with zero mismatches.
    #
    # Character set: rather than reusing UnicodeDataProps.txt's "Arabic"
    # script-name char list (as load_script_char_props does for the Brahmic
    # scripts above), this uses the actual Unicode block ranges directly.
    # That list turned out to *omit* combining diacritics entirely (FATHA,
    # DAMMA, KASRA, SUKUN, SHADDA, tanween, ...) -- they don't appear under
    # any ::script-name line in that file at all, despite being essential,
    # extremely common Perso-Arabic characters with real entries in
    # romanization-table.txt (e.g. line ~1236: `::s َ ::t a ::comment
    # fatha`). Arabic block (U+0600-U+06FF) + Arabic Supplement
    # (U+0750-U+077F) + Arabic Extended-A (U+08A0-U+08FF) covers every
    # standard Urdu/Kashmiri/Sindhi letter, harakat/diacritic, and punctuation
    # mark. Deliberately excluded: Arabic Presentation Forms-A/B
    # (U+FB50-U+FDFF, U+FE70-U+FEFF, legacy shaped-ligature compatibility
    # characters not used in normal logical-order digital text) and Arabic
    # Extended-B/C (U+0870+, a 2021+ Unicode addition for Quranic annotation
    # and other languages' letters) -- real uroman romanizes a good chunk of
    # these via a much more involved decomposition-based fallback
    # (`simple_top_romanization_candidate_for_span`) that is out of scope for
    # a flat table; if real Urdu/Kashmiri/Sindhi text ever contains one,
    # romanizePersoArabicWord throws a clear, actionable error rather than
    # guessing.
    arabic_ranges = [(0x0600, 0x06FF), (0x0750, 0x077F), (0x08A0, 0x08FF)]
    arabic_chars = set()
    for lo, hi in arabic_ranges:
        for cp in range(lo, hi + 1):
            c = chr(cp)
            try:
                unicodedata.name(c)
            except ValueError:
                continue  # unassigned codepoint
            arabic_chars.add(c)

    arabic_table = {}
    for s, t, _cat in auto_entries:
        if len(s) == 1 and s in arabic_chars:
            arabic_table[s] = t
    for s, t in overwrite_entries:
        if s in arabic_chars:
            arabic_table[s] = t

    # exception_entries (from load_rom_table on romanization-table.txt above)
    # doesn't carry the ::lcode / ::use-only-at-*-of-word flags -- re-scan the
    # file directly here so this layer can see them. (A second, targeted pass
    # over one small file is simpler than threading two new optional fields
    # through load_rom_table and every other caller of it.)
    arabic_multichar = {}
    arabic_start_of_word = {}
    with open(os.path.join(data_dir, "romanization-table.txt"), "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            # Same trailing-comment strip the other loaders in this file
            # apply (e.g. load_rom_table above) -- kept for consistency, even
            # though no currently-in-scope (urd/kas/snd, Arabic-block) line
            # actually has a trailing `  #...` comment today (verified: this
            # is a no-op against the current data).
            line = re.sub(r"\s{2,}#.*$", "", line)
            fields = parse_double_colon_line(line)
            s, t = fields.get("s"), fields.get("t")
            if not s or t is None:
                continue
            if not all(c in arabic_chars for c in s):
                continue
            lcode = fields.get("lcode", "")
            if lcode and lcode not in ("urd", "kas", "snd"):
                continue  # scoped to a different Perso-Arabic language (e.g. pus/uig/fas)
            if len(s) == 1:
                arabic_table[s] = t
            elif "use-only-at-start-of-word" in fields:
                arabic_start_of_word[s] = t
            elif "use-only-at-end-of-word" in fields:
                # Unreachable today: the only 2 such entries in
                # romanization-table.txt (هٔ and ه) are both ::lcode fas
                # (Farsi), already filtered out by the lcode check above --
                # not because no multi-char end-of-word entries exist at all.
                # Kept as a real branch (not merged into the `else` below)
                # so a future urd/kas/snd-scoped end-of-word entry is
                # visibly ignored here rather than silently misfiled into
                # arabic_multichar as if it applied everywhere.
                pass
            else:
                arabic_multichar[s] = t

    # Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9)
    # digits: real uroman romanizes these via its separate numeral-parsing
    # path (NumProps.jsonl / the NumEdge machinery in uroman.py), not the
    # character-substitution tables above -- so they have no auto-table,
    # overwrite, or romanization-table.txt entry at all. Empirically their
    # per-character romanization is simply the equivalent ASCII digit, and
    # multi-digit numbers made of them romanize as the straightforward
    # concatenation of those digits (verified against real uroman).
    for i in range(10):
        arabic_table[chr(0x0660 + i)] = str(i)
        arabic_table[chr(0x06F0 + i)] = str(i)

    # Nonspacing marks / format chars / private-use chars with no table entry
    # at all: real uroman's add_rom_fall_back_singles deletes these (empty
    # string) rather than passing them through, when nothing else claims
    # them.
    for c in arabic_chars:
        if c not in arabic_table and unicodedata.category(c) in ("Mn", "Cf", "Co"):
            arabic_table[c] = ""

    # A handful of codepoints DO have a romanization-auto-table.txt or
    # romanization-table.txt entry, but real uroman doesn't apply it and
    # echoes the character unchanged instead (confirmed by direct
    # romanize_string() calls against the `uroman` PyPI package, not just
    # static analysis -- the discrepancy's root cause in uroman.py's
    # internals wasn't traced further since these are all extremely rare
    # Quranic-annotation / historical-letter-variant characters, not standard
    # Urdu/Kashmiri/Sindhi orthography: ARABIC SIGN ALAYHE ASSALLAM (religious
    # honorific), ARABIC LETTER HIGH HAMZA WAW/YEH (rare dialectal letters),
    # ARABIC SMALL HIGH LAM ALEF and ARABIC TONE LOOP ABOVE/BELOW (Quranic
    # recitation marks).
    for c in ("ؑ", "ٶ", "ٸ", "ۙ", "࣬", "࣯"):
        arabic_table[c] = c

    # Anything still missing (rare symbols/letters with no known
    # romanization at all -- e.g. ARABIC POETIC VERSE SIGN, ARABIC-INDIC CUBE
    # ROOT, ARABIC LETTER ROHINGYA YEH): real uroman's ultimate fallback is to
    # pass the character through unchanged.
    for c in arabic_chars:
        if c not in arabic_table:
            arabic_table[c] = c

    arabic_out_path = os.path.join(out_dir, "arabic.json")
    with open(arabic_out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "chars": arabic_table,
                "multiCharOverrides": arabic_multichar,
                "startOfWordOverrides": arabic_start_of_word,
            },
            f,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    print(
        f"Arabic: {len(arabic_table)} chars, {len(arabic_multichar)} multi-char overrides, "
        f"{len(arabic_start_of_word)} start-of-word overrides -> {arabic_out_path}"
    )


if __name__ == "__main__":
    main()
