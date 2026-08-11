import { loadBrahmicScriptData } from "./brahmicData";
import { RomanizeError } from "./clean";

export type BrahmicScript =
  | "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Oriya"
  | "Tamil" | "Telugu" | "Kannada" | "Malayalam";

const CONSONANT_ONLY = /^[bcdfghjklmnpqrstvwxyz]+$/;

/**
 * Some letters' own table entry already comes with the default vowel fused
 * on (e.g. Devanagari/Bengali/Gurmukhi/Gujarati/Oriya/Tamil/Telugu/Kannada/
 * Malayalam NYA -> "nya", Bengali/Devanagari YYA -> "yya", Oriya YA -> "ya")
 * rather than as a bare consonant like most letters (e.g. "n", "k"). Ported
 * from uroman's add_default_abugida_vowel (uroman.py ~line 1652-1686), which
 * strips a trailing default vowel from the raw romanization via two regexes
 * -- a y-final-glide-cluster branch tried first, then a general
 * consonant-cluster fallback -- before deciding whether the letter is a
 * bare, vowel-pending consonant. Without this, a letter like "nya" is never
 * recognized as pending (CONSONANT_ONLY fails on the trailing "a"), so a
 * following vowel sign gets appended alongside it instead of replacing its
 * baked-in default vowel: verified against real uroman, e.g. Bengali
 * ঞা -> "nyaa" (base "ny" + vowel-sign "aa"), not "nyaaa".
 * Confirmed empirically this only actually fires for NYA/YYA/YA-type
 * entries across the currently-supported scripts' extracted tables -- every
 * other letter is already a bare consonant (no trailing default vowel to
 * strip), so this leaves all of them unchanged.
 */
function resolveLetterUnit(rom: string, defaultVowel: string): { rom: string; pending: boolean } {
  if (CONSONANT_ONLY.test(rom)) return { rom, pending: true };
  const dv = defaultVowel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const yGlideMatch = rom.match(new RegExp(`^([cfghkmnqrstxy]?y)(?:${dv})+$`));
  const match = yGlideMatch ?? rom.match(new RegExp(`^([bcdfghjklmnpqrstvwxyz]+)${dv}$`));
  if (match && CONSONANT_ONLY.test(match[1])) return { rom: match[1], pending: true };
  return { rom, pending: false };
}

/**
 * uroman's "rom tail" rule, ported from add_romanization (uroman.py ~line
 * 1846-1848) plus its companion early-out in add_default_abugida_vowel
 * (~line 1689-1690):
 *
 *     if regex.match(r'\+(m|ng|n|h|r)', rom):
 *         rom, edge_annotation = rom[1:], 'rom tail'
 *     new_rom = self.add_default_abugida_vowel(rom, start, end, annotation=edge_annotation)
 *     ...
 *     if 'tail' in annotation:
 *         return rom          # <- never gets a default abugida vowel
 *
 * A leading "+" in a romanization target (uroman's own data notation for
 * "this attaches to the preceding syllable as a tail", used for
 * anusvara/candrabindu/visarga-type signs) is stripped *and* permanently
 * disqualifies that unit from default-vowel insertion.
 *
 * For most such characters this is redundant with our category check, since
 * they are combining marks (Mn/Mc) and therefore never letters. But three
 * of the nine in-scope scripts have a "+"-target character whose Unicode
 * General Category really is a letter (Lo), so without this rule they get a
 * spurious default vowel:
 *   Tamil     U+0B83 TAMIL SIGN VISARGA (aytam) "+h"
 *   Bengali   U+09FC BENGALI LETTER VEDIC ANUSVARA "+m"
 *   Malayalam U+0D04 MALAYALAM LETTER VEDIC ANUSVARA "+m"
 * Verified against real uroman: அஃது -> "ahtu" (not "ahatu"), ஃக -> "hka"
 * (not "haka"), ৼক -> "mk" (not "mak"), ഄക -> "mka" (not "maka").
 *
 * Note the match is deliberately uroman's exact `\+(m|ng|n|h|r)` and not a
 * bare `startsWith("+")`: uroman only strips the "+" when it is followed by
 * one of those five targets, and would otherwise emit the "+" literally.
 * Every "+"-prefixed entry across all nine scripts' extracted tables is one
 * of "+m", "+ng", "+n", "+h" today, so this is behaviour-identical now and
 * merely stays faithful if uroman's data ever grows another one.
 */
const ROM_TAIL = /^\+(?:m|ng|n|h|r)/;

/**
 * uroman's consonant-doubling regex from expand_rom_with_special_chars
 * (uroman.py line 1437), ported verbatim: `regex.match(r'(ch|[bcdfghjklmnpqrstwz])', rom)`.
 * Used for the Gurmukhi ADDAK; see its handling in the main loop.
 */
const ADDAK_DOUBLES = /^(?:ch|[bcdfghjklmnpqrstwz])/;

function stripRomTail(rawRom: string): { rom: string; isTail: boolean } {
  if (ROM_TAIL.test(rawRom)) return { rom: rawRom.slice(1), isTail: true };
  return { rom: rawRom, isTail: false };
}

interface Unit {
  rom: string;
  /** The unit's *raw* table romanization, before resolveLetterUnit stripped
   * any baked-in default vowel (e.g. "nya" where `rom` is "ny"). uroman's
   * word-final schwa-deletion branch returns the raw `rom` variable, not the
   * stripped `base_rom` -- see the note on deletesFinalSchwa below. Equal to
   * `rom` for every ordinary bare-consonant letter. */
  raw: string;
  /** Still a bare consonant awaiting a default-vowel decision. Becomes false
   * once resolved by a vowel sign, a virama, or the final default-vowel pass. */
  pending: boolean;
  /** True if this unit's source char has "VOCALIC" in its Unicode name (the
   * vocalic R/RR/L/LL letters and vowel signs). uroman.py line 1732 denies
   * such a unit the default abugida vowel -- but only word-internally, since
   * the word-final branch (line 1723) is checked first. */
  vocalic: boolean;
  /** True if this unit prevents the *next* unit from counting as being at the
   * start of a word, per uroman's is_at_start_of_word (uroman.py line 1312):
   * a unit blocks only if its source char is alphabetic OR its romanization
   * ends in a letter. Units that are neither (e.g. the Devanagari stress
   * signs, which are nonspacing marks romanized to the empty string) leave
   * the following consonant "word-initial" as far as uroman is concerned. */
  blocksWordStart: boolean;
  /** True if this unit prevents *earlier* units from counting as being at the
   * end of a word, per uroman's is_at_end_of_word (uroman.py line 1333):
   * same test, from the other side -- a unit blocks if its source char is
   * alphabetic OR its romanization contains a letter. */
  blocksWordEnd: boolean;
  /** True if this unit is a bare nukta. is_at_end_of_word skips over nuktas
   * entirely (uroman.py line 1342-1345) rather than asking whether they
   * block, so the *next* unit after one decides word-finality. */
  isNukta: boolean;
  /** Whether uroman assigns this unit's first / last source char to this
   * script. uroman's abugida rules compare `chr_script_name(prev_s_char)` and
   * `chr_script_name(next_s_char)` against the current span's script (lines
   * 1730 and 1734), and prev_s_char / next_s_char are the source characters
   * immediately adjacent to the span -- i.e. the previous unit's LAST char
   * and the next unit's FIRST char. */
  firstInScript: boolean;
  lastInScript: boolean;
  /** True if this unit's first character immediately follows a virama in the
   * source word (i.e. it's the second consonant of an explicit C-virama-C
   * cluster, such as a geminate or conjunct). See deletesFinalSchwa's
   * companion rule below for why this matters at word end. Also set (despite
   * the name) for the unit produced by re-processing the consonant right
   * after a Gurmukhi ADDAK gemination mark (U+0A71) -- see the ADDAK handling
   * in the main loop below, which reuses this same flag/exception rather
   * than a separate one, since real uroman's word-final-vowel behavior is
   * identical in both cases. */
  precededByVirama: boolean;
}

/**
 * Word-final schwa deletion, ported from uroman's add_default_abugida_vowel
 * (uroman.py, roughly line 1722-1729 in the isi-nlp/uroman source):
 *
 *   if self.is_at_end_of_word(end):
 *       if (script_name in ("Devanagari",)) and (self.lcode not in ('san',)):
 *           return rom  # bare consonant, no vowel: DELETE
 *       elif self.lcode in ('asm', 'ben', 'guj', 'kas', 'pan'):
 *           return rom  # DELETE
 *       else:
 *           return base_rom_plus_vowel  # KEEP
 *
 * lcode is the ISO 639-3 code (hin, mar, ben, ...), not the script name --
 * they're independent here because e.g. Sanskrit (san) is Devanagari-script
 * but keeps the schwa, while Bengali/Assamese (ben/asm) are Bengali-script
 * but still delete it.
 *
 * NOTE (Task 14): the two deleting branches `return rom` -- the *raw*
 * romanization the table gave for this span -- and NOT `base_rom`, the bare
 * consonant that resolveLetterUnit() stripped a baked-in default vowel off
 * of. For ordinary letters the two are identical ("k" == "k"), which is why
 * this went unnoticed for so long, but for the handful of letters whose table
 * entry already carries the default vowel (NYA "nya" in all nine scripts,
 * Devanagari/Bengali YYA "yya", Oriya YYA "ya") it means schwa deletion is a
 * no-op: a word-final NYA is "nya" in *every* script and lcode, never "ny".
 * Verified against real uroman: मञ (hin) -> "manya", মঞ (ben) -> "manya",
 * મઞ (guj) -> "manya", ਮਞ (pan) -> "manya", മഞ (mal) -> "manya",
 * ମଞ (ori) -> "manya", मय़ (hin) -> "mayya", ময় (ben) -> "mayya",
 * ମୟ (ori) -> "maya" -- and मञ् (hin) -> "many", i.e. an explicit virama
 * still suppresses it, as it must (that path never reaches this branch).
 * This is what Unit.raw exists for.
 */
function deletesFinalSchwa(script: BrahmicScript, lcode: string): boolean {
  if (script === "Devanagari") return lcode !== "san";
  return ["asm", "ben", "guj", "kas", "pan"].includes(lcode);
}

/**
 * uroman's add_default_abugida_vowel (same source, ~line 1701-1729) checks
 * `is-virama(prev_s_char)` (line 1718: `return base_rom_plus_vowel`) *before*
 * it ever reaches the end-of-word / lcode schwa-deletion branch (line 1723).
 * So a word-final bare consonant that immediately follows a virama -- i.e.
 * the second half of an explicit C-virama-C cluster like a geminate or
 * conjunct (e.g. Dogri अज्ज "ajja", or Hindi अक्क "akka") -- always keeps its
 * default vowel, regardless of what deletesFinalSchwa() says for that
 * script/lcode. This is verified as a general, script-agnostic,
 * lcode-agnostic rule in uroman's own algorithm (confirmed empirically
 * against hin/mar/doi with synthetic and real words alike) -- it is not a
 * per-language or per-word special case.
 */

/**
 * TAMIL / SYLLABLE-POSITION NOTE (Task 9 investigation result).
 *
 * Tamil was expected to need a syllable-position-dependent romanization:
 * its dental/retroflex/alveolar letters ண/ன/ற/ள/ழ/ட have auto-table targets
 * derived from their Unicode names ("nn", "nnn", "rr", "ll", "lll", "tt"),
 * which would produce e.g. இன்று -> "innnrru" instead of uroman's "inru",
 * and the hypothesis was that uroman picks a shorter target in coda
 * (pre-virama) position via a per-entry `::t-end-of-syllable` field.
 *
 * That is NOT what uroman does for Tamil. Traced through uroman's actual
 * source and data:
 *
 *  1. `t-end-of-syllable` exists (uroman.py line 319 parses it; line 1789-1794
 *     in simple_top_romanization_candidate_for_span applies it via
 *     is_at_end_of_syllable), but grepping uroman's data shows every single
 *     `::t-end-of-syllable` entry lives in romanization-table.txt lines
 *     ~1130-1171 and is *Thai* (U+0E01 block, e.g. `::s ข ::t kh
 *     ::t-end-of-syllable k`). No Brahmic-script entry has one. It is also
 *     only ever read from romanization-table.txt: the `u2r` file format used
 *     by UnicodeDataOverwrite.txt hardcodes `t_at_end_of_syllable = None`
 *     (uroman.py line 299). So the field is structurally unavailable to the
 *     characters in question, and no `codaTarget` data can be extracted for
 *     them.
 *
 *  2. What uroman actually does is much simpler and position-independent:
 *     UnicodeDataOverwrite.txt overrides those letters outright, in every
 *     position --
 *         ::u 0B9F ::r t   ::comment instead of Tamil TT(A)
 *         ::u 0BA3 ::r n   ::comment instead of Tamil NN(A)
 *         ::u 0BA9 ::r n   ::comment instead of Tamil NNN(A)
 *         ::u 0BB1 ::r r   ::comment instead of Tamil RR(A)
 *         ::u 0BB3 ::r l   ::comment instead of Tamil LL(A)
 *         ::u 0BB4 ::r l   ::comment instead of Tamil LLL(A)
 *     (0B9F is then further overridden to "d" by romanization-table.txt.)
 *     uroman therefore does not distinguish ந/ண/ன or ர/ற at all -- they all
 *     romanize the same everywhere, onset or coda.
 *
 * Our extractor already reads UnicodeDataOverwrite.txt (added in Task 5), so
 * this engine inherits the correct behaviour with no coda logic at all. This
 * was confirmed by a 1023-word differential run against real uroman covering
 * every Tamil consonant in onset position with all 12 vowel signs, in
 * word-final coda position, in geminates, and in every coda+onset consonant
 * pair, plus 20 real Tamil sentences: zero mismatches involving these
 * letters. No `codaTarget` field is added, because uroman has no such data
 * for any script this engine supports -- adding one would be speculative
 * dead code, not a ported mechanism.
 */

export function romanizeBrahmicWord(word: string, script: BrahmicScript, lcode: string): string {
  const data = loadBrahmicScriptData(script);
  const { chars, categories, vowelSigns, virama, multiCharOverrides, defaultVowel } = data;

  const multiKeys = Object.keys(multiCharOverrides).sort((a, b) => b.length - a.length);
  const codepoints = Array.from(word);
  const units: Unit[] = [];
  const vocalicSet = new Set(data.vocalicChars);
  const nuktaSet = new Set(data.nuktaChars);
  const scriptSet = new Set(data.scriptChars);

  /** Python's str.isalpha() for a single char, which is what uroman's
   * is_at_start_of_word / is_at_end_of_word test the neighbouring *source*
   * character with -- true exactly for Unicode general category L*. */
  const isAlphaChar = (c: string) => (categories[c] ?? "").startsWith("L");
  /** uroman's char_is_nonspacing_mark. */
  const isNonspacingMark = (c: string | undefined) =>
    c !== undefined && categories[c] === "Mn";

  /**
   * Appends a unit for the source span [srcFirst..srcLast].
   *
   * `tableRom` is the romanization uroman's *static* table gives this span,
   * which is what its neighbour tests (is_at_start_of_word's lattice edge and
   * is_at_end_of_word's rom_rules lookup) see. It is the same as `rom` for
   * everything except the Gurmukhi ADDAK, whose emitted romanization is the
   * doubled following consonant but whose table entry is just "'".
   */
  const pushUnit = (
    srcFirst: string,
    srcLast: string,
    rom: string,
    raw: string,
    pending: boolean,
    tableRom: string = rom
  ) => {
    units.push({
      rom,
      raw,
      // uroman.py lines 1660-1663: add_default_abugida_vowel keys off
      // chr_script_name(first_s_char) and returns the bare romanization
      // immediately for any character it assigns to no script. Our tables
      // deliberately include such characters (ॐ -> "om", । -> ".", the
      // COMBINING DEVANAGARI LETTERs) because uroman's romanization data is
      // global; `scriptChars` is the script-gated subset that may take a
      // default vowel. Applied here, centrally, so every call site inherits
      // it. Verified: क꣭ (san) -> "kan", not "kana".
      pending: pending && scriptSet.has(srcFirst),
      firstInScript: scriptSet.has(srcFirst),
      lastInScript: scriptSet.has(srcLast),
      precededByVirama: prevWasVirama,
      vocalic: vocalicSet.has(srcLast),
      blocksWordStart: isAlphaChar(srcLast) || /[a-z]$/i.test(tableRom),
      blocksWordEnd: isAlphaChar(srcFirst) || /[a-z]/i.test(tableRom),
      isNukta: nuktaSet.has(srcFirst) && srcFirst === srcLast,
    });
  };

  /**
   * uroman's add_default_abugida_vowel returns the bare consonant, with no
   * default vowel, when the span is followed by a nonspacing mark that is in
   * turn followed by a vowel sign or a virama (uroman.py lines 1710-1717):
   *
   *     if self.uroman.char_is_nonspacing_mark(next_s_char) \
   *             and self.uroman.dict_bool[('is-vowel-sign', next2_s_char)]:
   *         return base_rom
   *     ...same for ('is-virama', next2_s_char)
   *
   * The direct (no intervening mark) forms of both rules are already handled
   * during the scan, by the vowel-sign and virama branches clearing `pending`
   * on the previous unit. This two-character lookahead is the version that
   * fires across a *nukta*, which is by far the commonest unromanized
   * nonspacing mark in these scripts: Oriya ଡ଼ି (DDA + NUKTA + vowel sign I)
   * must romanize as "ddi", not "ddai". Verified against real uroman:
   * ଓଡ଼ିଆ (ori) -> "oddiaa", ପଢ଼ୁଛନ୍ତି (ori) -> "paddhuchanti",
   * ରେଳଗାଡ଼ି (ori) -> "rellagaaddi".
   */
  const closedByMarkThenVowelSign = (nextIdx: number): boolean => {
    const n1 = codepoints[nextIdx];
    const n2 = codepoints[nextIdx + 1];
    if (!isNonspacingMark(n1) || n2 === undefined) return false;
    return Object.prototype.hasOwnProperty.call(vowelSigns, n2) || n2 === virama;
  };

  let i = 0;
  let prevWasVirama = false;
  while (i < codepoints.length) {
    let matchedLen = 0;
    let matchedRom: string | null = null;
    for (const key of multiKeys) {
      const keyChars = Array.from(key);
      if (codepoints.slice(i, i + keyChars.length).join("") === key) {
        matchedLen = keyChars.length;
        matchedRom = multiCharOverrides[key];
        break;
      }
    }
    if (matchedRom !== null) {
      // uroman applies the "+"-tail rule to every romanization it looks up,
      // for spans of any length -- so multi-char overrides get it too.
      const t = stripRomTail(matchedRom);
      const keyChars = Array.from(codepoints.slice(i, i + matchedLen).join(""));
      pushUnit(
        keyChars[0],
        keyChars[keyChars.length - 1],
        t.rom,
        t.rom,
        !t.isTail &&
          CONSONANT_ONLY.test(t.rom) &&
          !closedByMarkThenVowelSign(i + matchedLen)
      );
      prevWasVirama = false;
      i += matchedLen;
      continue;
    }

    const c = codepoints[i];

    if (virama !== null && c === virama) {
      const prev = units[units.length - 1];
      if (prev?.pending) prev.pending = false; // permanently: no vowel, ever
      prevWasVirama = true;
      i += 1;
      continue;
    }

    // GURMUKHI SIGN ADDAK (U+0A71): a gemination mark that doubles the
    // *following* consonant -- structurally the opposite of every other mark
    // handled here (which all modify the *preceding* unit). Verified against
    // real uroman (python `uroman` package) on multiple words, not just the
    // single golden fixture:
    //   ਅੱਜ  -> ajja     ਪੱਕਾ -> pakkaa   ਪੱਕ -> pakka
    //   ਅੱਕ  -> akka     ਸੱਚ  -> sacca    ਸੱਚਾ -> saccaa
    //   ਕੱਪ  -> kappa    ਕੱਪੜਾ -> kapparraa  ਬੱਚਾ -> baccaa
    // The pattern: the doubled consonant appears TWICE in the output -- once
    // as a bare/closed unit contributed by the ADDAK mark itself (no vowel,
    // ever), and once as the SAME following character's own ordinary
    // vowel-bearing contribution, produced by letting the main loop continue
    // to process that character normally (we only consume the ADDAK mark
    // itself here, not the consonant after it).
    //
    // Crucially, that second (normal) contribution must NOT be subject to
    // word-final schwa deletion even for lcodes that normally delete it
    // (e.g. pan): ਪੱਕ -> pakka keeps the final "a", not "pakk". This is the
    // exact same exception already implemented for units immediately
    // following a virama (see deletesFinalSchwa's companion comment above
    // and the `precededByVirama` field). This was verified empirically /
    // behaviorally against real uroman output (not traced through uroman's
    // exact source condition for ADDAK specifically -- Gurmukhi's own
    // Scripts.txt entry declares no virama at all, so a literal
    // `is-virama(prev_char)` match can't be confirmed by inspection; the
    // *effect* matches the virama exception, which is why we reuse the
    // `prevWasVirama` / `precededByVirama` machinery here rather than
    // inventing a parallel flag).
    //
    // Only the FIRST character of the following consonant's romanization is
    // doubled, not its whole (possibly multi-letter) romanization -- e.g.
    // ਖ ("kh") doubles to "k" + "kha" = "kkha", not "kh" + "kha". Verified
    // against real uroman for every aspirated consonant in Gurmukhi's table:
    // ਅੱਖ -> akkha, ਅੱਛ -> accha, ਅੱਘ -> aggha, ਅੱਥ -> attha,
    // ਅੱਧ -> addha, ਅੱਭ -> abbha, ਅੱਠ -> atttha (ਠ's own romanization "tth"
    // is itself multi-letter, and only its first letter "t" gets doubled).
    //
    // ADDAK_DOUBLES is uroman's own doubling regex, verbatim. Note it is NOT
    // "any consonant": `v`, `x` and `y` are deliberately absent from it, so
    // ADDAK before ਵ or ਯ does not double at all and falls through to the
    // ADDAK's own "'" romanization -- ਕੱਵ -> "ka'va", ਕੱਯ -> "ka'ya". It is
    // also not restricted to bare consonants: it matches the leading
    // consonant of a romanization that carries a baked-in default vowel, so
    // ADDAK before ਞ ("nya") doubles the "n" -- ਕੱਞ -> "kannya". Both of
    // those shapes were mismatches until Task 14's differential sweep;
    // porting uroman's literal character class fixes all three.
    if (c === "ੱ") {
      const nextC = codepoints[i + 1];
      const nextRawRom = nextC !== undefined ? chars[nextC] : undefined;
      if (nextRawRom !== undefined) {
        // No category gate on the following character: uroman's condition is
        // the regex alone. ADDAK before the Gurmukhi BINDI/TIPPI (nonspacing
        // marks whose "+m" entry tail-strips to "m", which the regex matches)
        // really does double -- verified against real uroman:
        // ਕੱਂਕ -> "kammk", ਕੱਂ -> "kamm", ਕੱੰ -> "kamm", ਕੱੰਕ -> "kammk",
        // ਸਕੱਂਕ -> "sakmmk". An earlier `isLetter &&` gate here suppressed
        // that (6 mismatches in Task 14's review sweep).
        const cleanNext = stripRomTail(nextRawRom).rom;
        if (ADDAK_DOUBLES.test(cleanNext)) {
          // The ADDAK's *emitted* romanization is the doubled consonant, but
          // uroman produces that by expanding the FOLLOWING consonant's edge
          // leftwards (expand_rom_with_special_chars, uroman.py line 1434-1445)
          // *after* add_default_abugida_vowel has already run. Its neighbour
          // tests therefore still see the ADDAK's own static table entry,
          // "'" (romanization-table.txt line 1611) -- which contains no
          // letter, so a consonant immediately BEFORE an ADDAK counts as
          // word-final and loses its schwa in a deleting language. Verified
          // against real uroman: ਇਕੱਠੀ (pan) -> "ikttthii" (not "ikattthii"),
          // ਸਕੱਕ -> "sakkka", ਸਕੱਖ -> "sakkkha", ਸਕੱ -> "sak'", while the
          // word-initial cases are unaffected: ਪੱਕਾ -> "pakkaa", ਕੱਠ ->
          // "katttha", ਅੱਜ -> "ajja".
          pushUnit(c, c, cleanNext.charAt(0), cleanNext.charAt(0), false, chars[c] ?? "'");
          prevWasVirama = true;
          i += 1; // consume only the ADDAK mark; the next iteration reprocesses nextC normally
          continue;
        }
      }
      // No following consonant to double (end of word, or next char isn't a
      // plain consonant) -- fall through to the normal chars[] lookup below,
      // which resolves ADDAK to "'" per uroman's own fallback rule.
    }

    if (Object.prototype.hasOwnProperty.call(vowelSigns, c)) {
      // uroman never treats a vowel sign as "belonging to" the preceding
      // consonant: every span (letter or mark) is romanized independently and
      // then run through add_default_abugida_vowel. What actually suppresses
      // the preceding consonant's default vowel is that function's
      // `if is-vowel-sign(next_s_char): return base_rom` (uroman.py line
      // 1704). Concatenating the sign onto the previous pending unit is an
      // equivalent, cheaper encoding of that -- EXCEPT when the vowel sign's
      // own romanization is itself a bare consonant, which is exactly the
      // case for the four VOCALIC signs (R/RR/L/LL -> "r"/"rr"/"l"/"ll") that
      // every one of these scripts except Gurmukhi and Tamil has. Those get
      // their *own* default-vowel decision in uroman, so they must become
      // their own pending unit here. Verified against real uroman:
      //   കൃ  (mal) -> "kra"   (word-final vocalic sign keeps the vowel)
      //   कृ  (hin) -> "kr"    (hin deletes word-final schwa)
      //   कृ  (san) -> "kra"   (san does not)
      //   কৃ  (ben) -> "kr"
      //   കൃക (mal) -> "krka"  (word-*internal* vocalic sign never gets one)
      //   कृक (hin) -> "krk"
      //   കൃൃ (mal) -> "krra"  (two in a row: only the last one gets it)
      const t = stripRomTail(vowelSigns[c]);
      const resolved = t.isTail
        ? { rom: t.rom, pending: false }
        : resolveLetterUnit(t.rom, defaultVowel);
      const prev = units[units.length - 1];
      if (resolved.pending) {
        if (prev?.pending) prev.pending = false; // uroman line 1704: no vowel, ever
        // The same nonspacing-mark-then-vowel-sign/virama lookahead the letter
        // and multi-char paths apply (uroman.py lines 1710-1717) -- a vocalic
        // sign is an ordinary pending span and is subject to it too. Only
        // reachable via orthographically invalid input (a vocalic vowel sign
        // followed by a mark and then a *second* vowel sign), but uroman does
        // apply it there: कृ + U+0900 + ि (san) -> "kri", not "krai".
        pushUnit(c, c, resolved.rom, t.rom, !closedByMarkThenVowelSign(i + 1));
      } else if (prev?.pending) {
        prev.rom += resolved.rom;
        prev.pending = false;
      } else {
        pushUnit(c, c, resolved.rom, t.rom, false);
      }
      prevWasVirama = false;
      i += 1;
      continue;
    }

    const rawRom = chars[c];
    if (rawRom === undefined) {
      // Apostrophes. Our per-script extracted tables only contain characters
      // from each script's own Unicode block, but uroman's romanization table
      // is global, and one non-block character genuinely occurs inside
      // Brahmic-script words: the apostrophe that Bodo (brx) writes with, e.g.
      // बर' ("Boro", the language's own name) and other /ɯ/-final words. It
      // reaches this engine because cleanNativeWord() deliberately preserves
      // apostrophes (see its comment). Both the ASCII apostrophe and the
      // modifier-letter apostrophe romanize to "'" -- verified against real
      // uroman: बर' (brx) -> "bar'", बरʼ (brx) -> "bar'", ल'ৰা (asm) ->
      // "la'raa". Note "'" is not an alphabetic character, so a consonant
      // *following* one counts as word-initial for uroman's
      // is_at_start_of_word and keeps its default vowel even in a
      // schwa-deleting language -- क'क (hin) -> "ka'ka", not "ka'k". That
      // falls out of pushUnit/blocksWordStart automatically here.
      if (c === "'" || c === "ʼ") {
        pushUnit(c, c, "'", "'", false);
        prevWasVirama = false;
        i += 1;
        continue;
      }
      // A nonspacing mark that none of uroman's tables romanizes. uroman
      // silently drops these: verified across every such character in all
      // nine scripts' Unicode blocks (a 81k-word differential sweep in Task
      // 14 covering each of them in eight positions), the rule is exactly
      // "unromanized General_Category=Mn -> empty string", with no
      // exceptions. That covers, among others:
      //   * the nukta (U+093C/09BC/0A3C/0ABC/0B3C/0C3C/0CBC), which only ever
      //     romanizes as part of a letter+nukta multiCharOverride (ड़ -> "dd",
      //     ক় -> "q"); on any other consonant it contributes nothing --
      //     समय़ (hin) -> "samay", ଓଡ଼ିଆ (ori) -> "oddiaa",
      //     ਸਟੇਸ਼ਨ (pan) -> "satteesana", କମ଼ (ori) -> "kama".
      //   * the candrabindu characters uroman has no entry for at all:
      //     Gurmukhi ADAK BINDI U+0A01, Gujarati U+0A81, Kannada U+0C81,
      //     Malayalam U+0D01, Devanagari INVERTED CANDRABINDU U+0900 --
      //     કઁ (guj) -> "ka", હુઁ (guj) -> "hu", માઁ (guj) -> "maa",
      //     ਕਁ (pan) -> "ka". (Devanagari/Bengali/Oriya candrabindu never
      //     reach here: they have real "+m"/"+n" entries.) This replaces a
      //     hardcoded per-script candrabindu list that Task 5 had flagged as
      //     wrong for exactly these two scripts.
      //   * Devanagari GRAVE/ACUTE ACCENT, Gurmukhi UDAAT and YAKASH,
      //     Gujarati SUKUN/SHADDA/MADDAH, Oriya SIGN OVERLINE, ...
      // Note an empty romanization is not the same as no span at all: it
      // makes the consonant after it word-initial (so कम़क (hin) -> "kamaka",
      // કઁક (guj) -> "kaka", both with a vowel a schwa-deleting language
      // would otherwise drop), while is_at_end_of_word additionally skips
      // *nuktas* specifically so the consonant before one can still be
      // word-final (कम़ (hin) -> "kam"). Both fall out of
      // pushUnit/blocksWordStart and the isNukta skip in the final pass.
      if (categories[c] === "Mn") {
        pushUnit(c, c, "", "", false);
        prevWasVirama = false;
        i += 1;
        continue;
      }
      // Everything else with no romanization -- avagraha (ঽ ઽ ଽ ఽ ಽ ഽ), the
      // AU length marks, Gurmukhi/Gujarati VISARGA, the Tamil accounting and
      // currency signs, ... -- is a DELIBERATE, DOCUMENTED divergence from
      // uroman, which passes such characters through into its output
      // verbatim (uroman("অঽ", lcode="ben") -> "aঽ"). Emitting a raw native
      // character from a function whose entire contract is "produce Latin
      // text an MMS aligner can consume" would be worse than failing, so
      // this engine keeps the original loud error instead. If one of these
      // ever shows up in real input, the fix is a romanization for it, not a
      // pass-through.
      throw new RomanizeError(
        `romanizeBrahmicWord: no romanization data for character U+${c.codePointAt(0)!
          .toString(16)
          .toUpperCase()} ("${c}") in word "${word}" (script ${script}). ` +
          `Re-run scripts/extract-uroman-data.py against a fresh uroman clone -- ` +
          `this character may be legitimately missing from our extracted table.`
      );
    }
    // No general-category gate here: uroman's add_default_abugida_vowel is
    // applied to every span's romanization regardless of category, and what
    // keeps combining marks (anusvara, visarga, candrabindu, ...) from
    // collecting a default vowel is the "+"-tail rule above, not their
    // category. Checked exhaustively against all nine extracted tables: the
    // ONLY non-letter, non-tail chars whose romanization is a bare consonant
    // are the four VOCALIC vowel signs handled in the branch above -- so
    // dropping the category gate is behaviour-identical on today's data while
    // staying faithful to uroman's actual algorithm.
    const { rom, isTail } = stripRomTail(rawRom);
    const resolved = isTail ? { rom, pending: false } : resolveLetterUnit(rom, defaultVowel);
    pushUnit(c, c, resolved.rom, rom, resolved.pending && !closedByMarkThenVowelSign(i + 1));
    prevWasVirama = false;
    i += 1;
  }

  // Final default-abugida-vowel pass. The branch order below is uroman's own
  // order in add_default_abugida_vowel (uroman.py lines 1718-1734); the
  // earlier branches of that function (lines 1704-1717: a following vowel
  // sign / medial sign / subjoined letter / virama all yield the bare
  // consonant) are already applied during the scan above, by clearing
  // `pending` when those characters are consumed.
  let out = "";
  for (let idx = 0; idx < units.length; idx++) {
    const u = units[idx];
    if (!u.pending) {
      out += u.rom;
      continue;
    }
    const withVowel = u.rom + defaultVowel; // uroman's base_rom_plus_vowel
    const prev = units[idx - 1];
    // The literal next unit -- what uroman's `next_s_char = s[end]` sees, used
    // by the script comparison on line 1734.
    const next = units[idx + 1];
    // is_at_end_of_word skips over nuktas (uroman.py line 1342-1345), so a
    // *different*, nukta-skipped neighbour decides word-finality.
    let endIdx = idx + 1;
    while (units[endIdx]?.isNukta && endIdx + 1 < units.length) endIdx += 1;
    const nextForWordEnd = units[endIdx];
    if (u.precededByVirama) {
      // line 1718 -- see deletesFinalSchwa's companion comment above.
      out += withVowel;
    } else if (prev === undefined || !prev.blocksWordStart) {
      // line 1720, is_at_start_of_word. Note this is genuinely *not* the same
      // as "index 0": a preceding unit only counts if its source char is a
      // letter or its romanization ends in one, so e.g. a Devanagari stress
      // sign (a nonspacing mark romanized to the empty string) leaves the
      // consonant after it word-initial. Verified against real uroman:
      // क॑क (hin) -> "kaka", not "kak"; कक॑क (hin) -> "kakka".
      // (uroman also guards this branch with `not regex.search('r[aeiou]',
      // rom)`; no entry in any of the nine extracted tables has such a
      // romanization, so it is a no-op here and is left unimplemented rather
      // than added as untestable dead code.)
      out += withVowel;
    } else if (nextForWordEnd === undefined || !nextForWordEnd.blocksWordEnd) {
      // line 1723, is_at_end_of_word -- same asymmetry as above: only the
      // immediately following span is consulted, so a trailing empty-rom mark
      // does not stop this unit from being word-final (कक॑ (hin) -> "kak").
      out += deletesFinalSchwa(script, lcode) ? u.raw : withVowel;
    } else if (!prev.lastInScript) {
      // line 1730, `chr_script_name(prev_s_char) != script_name`. Reachable
      // because our tables intentionally carry characters uroman assigns to
      // no script (ॐ, danda, the COMBINING DEVANAGARI LETTERs) -- a letter
      // right after one of those keeps its default vowel even where the rules
      // below would drop it. Verified: ꣯ऌअ (san) -> "rlaa".
      out += withVowel;
    } else if (u.vocalic) {
      out += u.rom; // line 1732
    } else if (next.firstInScript) {
      out += withVowel; // line 1734
    } else {
      // line 1741, the final `return rom` fall-through: the next character
      // exists but belongs to another script (in practice, to none). Note it
      // returns the *raw* romanization, like the schwa-deletion branch, not
      // base_rom + vowel. Verified: உறௐ (tam) -> "urom" (not "uraom") --
      // Tamil never deletes a word-final schwa, so this is the only rule that
      // can strip one; வॺकणष꣯ … likewise ष -> "ss" before a script-less mark.
      out += u.raw;
    }
  }
  return out;
}

// (The per-script candrabindu table that used to live here is gone: Task 14
// replaced it with the general "unromanized nonspacing mark -> empty string"
// rule in romanizeBrahmicWord above, which is what real uroman actually does
// and which covers the Gurmukhi/Gujarati candrabindus the old hardcoded "n"
// got wrong, plus five other scripts' worth of marks it never listed.)
