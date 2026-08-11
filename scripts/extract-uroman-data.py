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


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    repo_dir, out_dir = sys.argv[1], sys.argv[2]
    data_dir = os.path.join(repo_dir, "uroman", "data")
    os.makedirs(out_dir, exist_ok=True)

    script_props = load_script_char_props(os.path.join(data_dir, "UnicodeDataProps.txt"))

    auto_entries = load_auto_table(os.path.join(data_dir, "romanization-auto-table.txt"))
    exception_entries = load_rom_table(os.path.join(data_dir, "romanization-table.txt"))

    # Build a combined char -> target map per script: auto-table first, then
    # exceptions override (exceptions file is loaded second by uroman itself,
    # see uroman.py's load_rom_data(), so it takes precedence on conflicts).
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
        multichar = {}
        for s, t in exception_entries:
            if len(s) == 1 and s in char_set:
                table[s] = t  # single-char override (category unknown from this
                # file; keep whatever auto-table said, or default to Lo if new)
                cats.setdefault(s, "Lo")
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
