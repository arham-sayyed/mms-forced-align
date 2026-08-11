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
    Values run until the next '::' or end of line."""
    fields = {}
    for m in re.finditer(r'::(\S+)\s+(.*?)(?=\s+::\S+\s|\s*$)', line):
        key, val = m.group(1), m.group(2).strip()
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
        }
        out_path = os.path.join(out_dir, f"{script_name.lower()}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)
        print(f"{script_name}: {len(table)} chars, {len(out['vowelSigns'])} vowel signs, "
              f"virama={props['virama']!r}, {len(multichar)} multi-char overrides -> {out_path}")

    # Arabic block: flat table, no per-script char-set filtering needed --
    # the file itself is already scoped to exactly what we need.
    arabic_entries = load_rom_table(os.path.join(data_dir, "romanization-table-arabic-block.txt"))
    arabic_table = {}
    for s, t in arabic_entries:
        arabic_table[s] = t
    arabic_out_path = os.path.join(out_dir, "arabic.json")
    with open(arabic_out_path, "w", encoding="utf-8") as f:
        json.dump({"chars": arabic_table}, f, ensure_ascii=False, indent=2, sort_keys=True)
    print(f"Arabic: {len(arabic_table)} chars -> {arabic_out_path}")


if __name__ == "__main__":
    main()
