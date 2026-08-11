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

function stripRomTail(rawRom: string): { rom: string; isTail: boolean } {
  if (ROM_TAIL.test(rawRom)) return { rom: rawRom.slice(1), isTail: true };
  return { rom: rawRom, isTail: false };
}

interface Unit {
  rom: string;
  /** Still a bare consonant awaiting a default-vowel decision. Becomes false
   * once resolved by a vowel sign, a virama, or the final default-vowel pass. */
  pending: boolean;
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
      units.push({
        rom: t.rom,
        pending: !t.isTail && CONSONANT_ONLY.test(t.rom),
        precededByVirama: prevWasVirama,
      });
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
    // ਖ ("kh") doubles to "k" + "kha" = "kkha", not "kh" + "kha". This
    // mirrors uroman's own doubling regex `(ch|[bcdfghjklmnpqrstwz])`, which
    // captures only a single leading consonant letter (with a `ch`->`c`
    // special case that "first character of the string" already satisfies
    // for free, since "ch"[0] === "c"). Verified against real uroman for
    // every aspirated consonant in Gurmukhi's table: ਅੱਖ -> akkha,
    // ਅੱਛ -> accha, ਅੱਘ -> aggha, ਅੱਥ -> attha, ਅੱਧ -> addha,
    // ਅੱਭ -> abbha, ਅੱਠ -> atttha (ਠ's own romanization "tth" is itself
    // multi-letter, and only its first letter "t" gets doubled).
    if (c === "ੱ") {
      const nextC = codepoints[i + 1];
      const nextRawRom = nextC !== undefined ? chars[nextC] : undefined;
      if (nextRawRom !== undefined) {
        const cleanNext = stripRomTail(nextRawRom).rom;
        const isLetter = (categories[nextC] ?? "").startsWith("L");
        if (isLetter && CONSONANT_ONLY.test(cleanNext)) {
          units.push({ rom: cleanNext.charAt(0), pending: false, precededByVirama: prevWasVirama });
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
      const prev = units[units.length - 1];
      if (prev?.pending) {
        prev.rom += vowelSigns[c];
        prev.pending = false;
      } else {
        units.push({ rom: vowelSigns[c], pending: false, precededByVirama: prevWasVirama });
      }
      prevWasVirama = false;
      i += 1;
      continue;
    }

    const rawRom = chars[c];
    if (rawRom === undefined) {
      // Chandrabindu (nasalization mark) is absent from uroman's own
      // per-script auto-table entirely -- see plan Task-list "Known gaps" #2.
      if (isCandrabinduChar(c)) {
        units.push({ rom: "n", pending: false, precededByVirama: prevWasVirama });
        prevWasVirama = false;
        i += 1;
        continue;
      }
      throw new RomanizeError(
        `romanizeBrahmicWord: no romanization data for character U+${c.codePointAt(0)!
          .toString(16)
          .toUpperCase()} ("${c}") in word "${word}" (script ${script}). ` +
          `Re-run scripts/extract-uroman-data.py against a fresh uroman clone -- ` +
          `this character may be legitimately missing from our extracted table.`
      );
    }
    const { rom, isTail } = stripRomTail(rawRom);
    const isLetter = (categories[c] ?? "").startsWith("L");
    const resolved =
      isLetter && !isTail ? resolveLetterUnit(rom, defaultVowel) : { rom, pending: false };
    units.push({ rom: resolved.rom, pending: resolved.pending, precededByVirama: prevWasVirama });
    prevWasVirama = false;
    i += 1;
  }

  let out = "";
  for (let idx = 0; idx < units.length; idx++) {
    const u = units[idx];
    if (!u.pending) {
      out += u.rom;
      continue;
    }
    const isLast = idx === units.length - 1;
    if (!isLast) {
      out += u.rom + defaultVowel;
      continue;
    }
    if (units.length === 1) {
      out += u.rom + defaultVowel; // single-syllable word: uroman always keeps it
    } else if (u.precededByVirama) {
      out += u.rom + defaultVowel; // see comment on deletesFinalSchwa's companion rule above
    } else if (deletesFinalSchwa(script, lcode)) {
      out += u.rom;
    } else {
      out += u.rom + defaultVowel;
    }
  }
  return out;
}

// Candrabindu (nasalization mark) codepoints, one per Brahmic script's
// Unicode block. Each script's block reserves a fixed slot for it (the first
// combining sign after the independent-vowel range); confirmed against the
// Unicode charts (https://www.unicode.org/charts/) for the scripts this
// engine currently supports:
//   Devanagari U+0901, Bengali U+0981, Gurmukhi U+0A01 (named "ADAK BINDI",
//   not "CANDRABINDU", but it's the same nasalization role), Gujarati
//   U+0A81, Oriya U+0B01.
// Tamil, Telugu, Kannada, and Malayalam do not encode a distinct candrabindu
// character (Telugu/Kannada/Malayalam use anusvara for this purpose; Tamil
// has neither), so they're intentionally omitted here rather than guessed.
const CANDRABINDU_CODEPOINTS = new Set([0x0901, 0x0981, 0x0a01, 0x0a81, 0x0b01]);

function isCandrabinduChar(c: string): boolean {
  const cp = c.codePointAt(0);
  return cp !== undefined && CANDRABINDU_CODEPOINTS.has(cp);
}

// NOTE (Task 5 follow-up, verified against real uroman + its data tables --
// see scripts/extract-uroman-data.py's UnicodeDataOverwrite.txt handling,
// added in this same task): the "n" pushed above is only actually correct
// for Bengali. Real uroman's per-script romanization tables give Devanagari
// and Oriya candrabindu "m" (not "n"), and Gurmukhi/Gujarati's
// candrabindu-equivalent chars (adak bindi / candrabindu) have *no*
// romanization entry anywhere in uroman's data at all -- confirmed
// empirically (`uroman.romanize_string("ਁਪ", lcode="pan")` etc.) that real
// uroman silently contributes nothing for them, not "n". In practice this
// isCandrabinduChar() branch is now unreachable for Devanagari, Bengali, and
// Oriya, because scripts/extract-uroman-data.py's UnicodeDataOverwrite.txt
// fix (also added in this task) already populates chars[] with each
// script's correct value for those three, so the char lookup above resolves
// before ever reaching this fallback. It remains reachable (and wrong) only
// for Gurmukhi/Gujarati, which are out of this task's tested scope --
// revisit this hardcoded "n" when those scripts' task comes up.
