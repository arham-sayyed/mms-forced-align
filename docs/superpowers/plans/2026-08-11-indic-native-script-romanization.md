# Indic Native-Script Romanization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `mms-forced-align` the ability to align native-script transcripts (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Perso-Arabic) in 20 Indic languages, by romanizing them internally to the flat-ASCII form the acoustic model's vocab requires, aligning, then mapping timings back onto the original native-script words — with zero word loss, ever.

**Architecture:** A new `src/romanize/` module ports the *relevant slice* of `isi-nlp/uroman`'s actual algorithm and character data (not a full 100+-script port, and — after empirical testing ruled it out, see "Why not an existing library" below — not a third-party transliteration library either) directly into TypeScript: per-script character tables extracted from uroman's own data files (already done, see Task 1) drive a shared abugida state machine (virama suppresses the default vowel, vowel-signs replace it, bare consonants get it inserted) plus a word-final schwa-deletion rule that is faithfully ported from uroman's own `add_default_abugida_vowel` (exact source excerpted in Task 3). Perso-Arabic (Urdu/Kashmiri/Sindhi) is a separate, much simpler flat character-substitution engine, also using uroman's own data. A new `alignNative()` wrapper composes romanization with the package's existing `align()`, enforcing a hard word-count invariant and remapping the model's output back onto the caller's original native-script words.

**Tech Stack:** TypeScript, existing `mms-forced-align` package conventions (vitest, tsup). No new runtime dependencies — the character data is static JSON checked into the repo (see `src/romanize/data/`), not loaded from any library at runtime.

## Why not an existing JS transliteration library

This was investigated first (see prior research summarized below) and rejected. `@indic-transliteration/sanscript` (the strongest pure-JS candidate found, zero native deps) produces phonetically-reasonable Latin output, but it is **not** uroman's output — and since the acoustic model this package aligns against was trained on uroman-romanized text, matching uroman specifically (not "a reasonable romanization") is what accuracy depends on. Concrete, empirically-confirmed divergences:
- Tamil க (ka) — sanscript renders it context-dependently as `k`/`g`/`gh` depending on position (a scholarly Grantha-style convention); uroman always renders it `k`, flatly, from a single unconditional table entry.
- Bengali ব (ba) — sanscript renders `v` (following the Devanagari-derived ISO letter-identity convention); uroman renders `b` (matching actual Bengali pronunciation) directly from its own table.
- sanscript's `iso` output carries diacritics (`ā`, `ṭ`, `ṇ`...) that are not in the model's vocab (`a-z` + apostrophe only, see `src/vocab.json`) and would need a whole separate normalization layer to flatten — a layer that would have to reinvent, imperfectly, distinctions uroman's own table already encodes correctly (e.g. its retroflex-doubling and digraph choices).
- sanscript has real gaps for our scope: no scheme at all for Kashmiri/Sindhi, a broken Urdu scheme, and a nukta-handling bug that leaks raw Bengali nukta characters (`়`) into its output untransliterated.

Working directly from uroman's own tables sidesteps all of this — for any given character, there is exactly one source of truth, and it's the one the acoustic model was actually trained against.

## Global Constraints

- The acoustic model's vocabulary is **exactly** 26 lowercase Latin letters + apostrophe (`D:\dev\projects\mms-forced-align\src\vocab.json`) — every romanized word must satisfy this or `align()` throws `VocabError`. No digits, no punctuation, no diacritics.
- **Zero word loss is non-negotiable.** `romanizeWords()` must return exactly one output string per input word, in the same order. Any situation that would otherwise drop, merge, or split a word must throw `RomanizeError` instead — never silently degrade.
- Accuracy target: **exact character-for-character match** against real uroman output (`python -m pip install uroman`, or the cloned `isi-nlp/uroman` repo), validated per-word via the golden fixtures in `test/fixtures/romanize/`. "Close enough" is not the bar — if a mismatch is found, go read uroman's own source/data (clone fresh: `git clone https://github.com/isi-nlp/uroman`) and port the actual rule; do not invent a plausible-looking substitute.
- In scope: 20 languages — hi(hin), mr(mar), ne(nep), sa(san), mai(mai), doi(doi), kok(kok), brx(brx) on Devanagari; bn(ben), as(asm) on Bengali; pa(pan) on Gurmukhi; gu(guj) on Gujarati; od(ori) on Oriya; ta(tam) on Tamil; te(tel) on Telugu; kn(kan) on Kannada; ml(mal) on Malayalam; ur(urd), ks(kas), sd(snd) on Perso-Arabic; en(eng) Latin passthrough. **Out of scope** (explicit product decision, revisit later): sat-IN (Santali/Ol Chiki), mni-IN (Manipuri/Meitei Mayek) — uroman's own data for these two is incomplete/unreliable, so porting it wouldn't be accurate either.
- No native compilation / no new runtime deps — this needs to run cheaply on a per-second-billed Railway container. Everything here is pure TS + static JSON.
- Follow existing package conventions: `AlignError`/`VocabError`/`DecodeError` style for new error classes (see `src/vocab.ts`), vitest for tests, `src/index.ts` re-exports the public surface.

---

## Reference material already prepared (do not redo this research)

The following were generated and validated during planning and are already committed in this repo — **read them before writing code**, don't re-derive from scratch:

- `src/romanize/data/{devanagari,bengali,gurmukhi,gujarati,oriya,tamil,telugu,kannada,malayalam}.json` — per-script character tables extracted directly from uroman's own `romanization-auto-table.txt` + `romanization-table.txt` (exceptions, which override the auto-table on conflicts — see `scripts/extract-uroman-data.py` for exactly how). Each file has: `defaultVowel` (always `"a"` for these 9 scripts), `virama` (the script's virama character, or `null`), `vowelSigns` (matra char → target string), `chars` (every letter/sign → target string), `categories` (Unicode General Category per char — **only** `Lo`/`Lu`/`Ll` letters are candidates for default-vowel insertion; `Mc`/`Mn` marks like anusvara never are, even when their target happens to look consonant-only, e.g. anusvara → `"m"`), `multiCharOverrides` (multi-codepoint source sequences, e.g. a consonant+nukta combination, that must be tried before falling back to single-char lookup).
- `src/romanize/data/arabic.json` — flat 178-entry character table for Perso-Arabic (covers core Arabic block + the Urdu/Sindhi/Kashmiri extended letters ٹ ڈ ڑ ں ے پ چ گ ژ + harakat diacritics + punctuation). No lcode-specific branching needed — same table serves ur/ks/sd.
- `scripts/extract-uroman-data.py` — regenerates the above from a fresh uroman clone: `python scripts/extract-uroman-data.py <path-to-cloned-uroman-repo> src/romanize/data`. Re-run this if you need to add a script/language later, or to double check against the latest upstream.
- `test/fixtures/romanize/golden-sentences.json` — 23 real sentences (one per language incl. `en`), each with real `uroman_output` (whole-sentence).
- `test/fixtures/romanize/golden-words.json` — 168 individual (native-word → real-uroman-output) pairs for the 17 Brahmic-script languages, derived from the sentences above by calling uroman **per word** (matching exactly how our pipeline will call it — avoids any whole-sentence-vs-per-word ambiguity). This is the primary TDD oracle for Tasks 3–9. **It does not yet cover Perso-Arabic (ur/ks/sd) at word granularity** — Task 10 needs to generate that the same way (see the task for the exact command).
- `scripts/prototype-brahmic-reference.mjs` — a validated (92% exact-match against `golden-words.json` on first working version — every remaining gap below is understood, not mysterious) throwaway JS prototype of the core abugida algorithm. **This is not the file to ship** — Task 3 has you rewrite it properly in TypeScript with types and tests — but read it, it's the concrete algorithm this plan describes in prose, already debugged once.
- `scripts/gen-perword-fixtures.py` — regenerates `golden-words.json` from `golden-sentences.json`; reuse its pattern (`uroman_string.romanize_string(word, lcode=lcode)` called once per word) if you need to expand fixture coverage (Task 8, Task 14).

### Known gaps found during prototyping — read before starting the relevant task

These are precise, not vague — each is pinned to a task below:
1. **Tamil coda/geminate consonants** (Task 9): a single-character lookup (e.g. ன் NNNA → `"nnn"`, per the raw table) is uroman's *isolated-letter* value, but geminate/coda contexts (ற்ற, ன் in coda position) use a different, shorter target uroman selects via syllable-position logic (`is_at_end_of_syllable`, `t-end-of-syllable` field — see `uroman.py` around line 319 in a fresh clone) that this plan's simplified single-character-table model doesn't capture. Tamil needs deeper, dedicated work — budget for it, don't assume it "falls out" of the shared engine like the other 8 scripts did.
2. **Candrabindu** (chandrabindu nasalization mark, e.g. Bengali ঁ, Oriya ଁ): absent from uroman's own per-script auto-table entirely (confirmed: no `BENGALI SIGN CANDRABINDU` row exists), yet real uroman romanizes it to `n`. It's handled by some generic Unicode-name-pattern rule in uroman's engine, not a table lookup. Add an explicit rule: any character whose Unicode name contains `CANDRABINDU` → `"n"` (verify against fixtures once Task 5/7 add coverage).
3. **Gurmukhi ADDAK** (ੱ, U+0A71, gemination mark — doubles the *following* consonant): not handled by simple per-character lookup at all; needs dedicated logic in Task 6.
4. **Bengali `চ্ছ`-family conjuncts and word-final anusvara context** (Task 5): `পেয়েছি` → real uroman gives `peyechhi` (double h) where the simplified per-character model gives `peyechi` (single h) — the character-level target for ছ needs re-verification against uroman's actual selected candidate (there may be more than one candidate rule for this character and the simplified model picked the wrong one). Separately, `এবং` → real uroman gives `ebang` (word-final anusvara → `ng`) where the generic anusvara rule gives `ebam` — this looks like a specific, narrow context rule (possibly only for this specific lexical item, since uroman does not appear to have general phonological rules beyond its tables) rather than a systematic pattern; don't over-generalize a fix from one example — expand fixture coverage (Task 14) to see whether this recurs before spending real effort on it.
5. **One Dogri anomaly**: `अज्ज` (doi) → real uroman keeps the final vowel (`ajja`) even though Dogri is Devanagari-non-Sanskrit and should delete it per the general rule (confirmed correct on every *other* word in the same sentence, e.g. `अनुभव` → `anubhav`, correctly deleted). Likely explanation: a dedicated multi-char override for the geminate cluster `ज्ज` (same pattern as Tamil's geminate overrides) that bakes in a vowel as part of a fixed unit, rather than this being a per-lcode exception. Check `romanization-table.txt` for a `ज्ज`-keyed entry before assuming this is a bug in the general rule.

---

## Task 1: Verify the extracted data is current, and land the reference material

**Files:**
- Already created (this task just verifies + commits them): `scripts/extract-uroman-data.py`, `src/romanize/data/*.json`, `test/fixtures/romanize/*.json`, `scripts/gen-perword-fixtures.py`, `scripts/prototype-brahmic-reference.mjs`.
- Create: `src/romanize/data/README.md` (provenance note).

**Interfaces:**
- Produces: the data files every later task loads. No code interfaces yet.

- [ ] **Step 1: Re-clone uroman fresh and re-run the extractor, to confirm reproducibility**

```bash
git clone https://github.com/isi-nlp/uroman /tmp/uroman-verify
python scripts/extract-uroman-data.py /tmp/uroman-verify src/romanize/data
git diff --stat src/romanize/data
```

Expected: no diff (or a trivial diff if upstream uroman has changed since this plan was written — if so, review the diff, it should only ever change specific character mappings, never wholesale). If the diff is empty or trivial, the checked-in data is confirmed reproducible from a clean upstream clone.

- [ ] **Step 2: Document provenance**

Create `src/romanize/data/README.md`:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add scripts/extract-uroman-data.py scripts/gen-perword-fixtures.py \
  scripts/prototype-brahmic-reference.mjs src/romanize/data \
  test/fixtures/romanize docs/superpowers/plans
git commit -m "chore: land uroman-derived romanization data + golden fixtures"
```

---

## Task 2: Script detection and word cleaning

**Files:**
- Create: `src/romanize/scriptDetect.ts`
- Create: `src/romanize/clean.ts`
- Test: `test/romanize/scriptDetect.test.ts`
- Test: `test/romanize/clean.test.ts`

**Interfaces:**
- Produces:
  - `type ScriptName = "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Oriya" | "Tamil" | "Telugu" | "Kannada" | "Malayalam" | "Arabic" | "Latin"`
  - `detectScript(word: string): ScriptName | "Mixed" | "Unknown"`
  - `cleanNativeWord(word: string): string`

- [ ] **Step 1: Write failing tests for script detection**

```typescript
// test/romanize/scriptDetect.test.ts
import { describe, it, expect } from "vitest";
import { detectScript } from "../../src/romanize/scriptDetect";

describe("detectScript", () => {
  it("detects Devanagari", () => expect(detectScript("आज")).toBe("Devanagari"));
  it("detects Bengali", () => expect(detectScript("আজ")).toBe("Bengali"));
  it("detects Gurmukhi", () => expect(detectScript("ਅੱਜ")).toBe("Gurmukhi"));
  it("detects Gujarati", () => expect(detectScript("આજે")).toBe("Gujarati"));
  it("detects Oriya", () => expect(detectScript("ଆଜି")).toBe("Oriya"));
  it("detects Tamil", () => expect(detectScript("இன்று")).toBe("Tamil"));
  it("detects Telugu", () => expect(detectScript("ఈరోజు")).toBe("Telugu"));
  it("detects Kannada", () => expect(detectScript("ಇಂದು")).toBe("Kannada"));
  it("detects Malayalam", () => expect(detectScript("ഇന്ന്")).toBe("Malayalam"));
  it("detects Arabic", () => expect(detectScript("آج")).toBe("Arabic"));
  it("detects Latin", () => expect(detectScript("hello")).toBe("Latin"));
  it("detects Latin for a word with an apostrophe", () => expect(detectScript("don't")).toBe("Latin"));
  it("returns Unknown for a word with no letters", () => expect(detectScript("123")).toBe("Unknown"));
  it("returns Mixed for a word mixing two scripts", () => expect(detectScript("आजhi")).toBe("Mixed"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/romanize/scriptDetect.test.ts`
Expected: FAIL — `Cannot find module '../../src/romanize/scriptDetect'`

- [ ] **Step 3: Implement script detection**

Detect via Unicode codepoint block ranges (fast, no data-file dependency — this only needs to route a word to the right engine, the data files handle actual per-character mapping):

```typescript
// src/romanize/scriptDetect.ts
export type ScriptName =
  | "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Oriya"
  | "Tamil" | "Telugu" | "Kannada" | "Malayalam" | "Arabic" | "Latin";

const RANGES: Array<[ScriptName, number, number]> = [
  ["Devanagari", 0x0900, 0x097f],
  ["Bengali", 0x0980, 0x09ff],
  ["Gurmukhi", 0x0a00, 0x0a7f],
  ["Gujarati", 0x0a80, 0x0aff],
  ["Oriya", 0x0b00, 0x0b7f],
  ["Tamil", 0x0b80, 0x0bff],
  ["Telugu", 0x0c00, 0x0c7f],
  ["Kannada", 0x0c80, 0x0cff],
  ["Malayalam", 0x0d00, 0x0d7f],
  ["Arabic", 0x0600, 0x06ff],
];

function scriptOfCodepoint(cp: number): ScriptName | null {
  for (const [name, lo, hi] of RANGES) {
    if (cp >= lo && cp <= hi) return name;
  }
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || cp === 0x27 /* ' */) {
    return "Latin";
  }
  return null; // digits, punctuation, unrelated symbols -- not script-bearing
}

export function detectScript(word: string): ScriptName | "Mixed" | "Unknown" {
  let found: ScriptName | null = null;
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    const script = scriptOfCodepoint(cp);
    if (script === null) continue; // combining marks / punctuation: ignore for detection
    if (found === null) {
      found = script;
    } else if (found !== script) {
      return "Mixed";
    }
  }
  return found ?? "Unknown";
}
```

Note: combining marks (vowel signs, virama, nukta, anusvara etc.) fall in the same Unicode block as their script's base letters for every script above, so they're already covered by the block ranges — `scriptOfCodepoint` doesn't need special-casing for them.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/romanize/scriptDetect.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for word cleaning**

```typescript
// test/romanize/clean.test.ts
import { describe, it, expect } from "vitest";
import { cleanNativeWord, RomanizeError } from "../../src/romanize/clean";

describe("cleanNativeWord", () => {
  it("strips a trailing danda", () => expect(cleanNativeWord("किया।")).toBe("किया"));
  it("strips trailing latin punctuation", () => expect(cleanNativeWord("hello,")).toBe("hello"));
  it("keeps combining marks (vowel signs / virama)", () => expect(cleanNativeWord("सुन्दरम्")).toBe("सुन्दरम्"));
  it("keeps apostrophes", () => expect(cleanNativeWord("don't")).toBe("don't"));
  it("throws if nothing alphabetic remains", () => {
    expect(() => cleanNativeWord("।।।")).toThrow(RomanizeError);
  });
});
```

- [ ] **Step 6: Run to verify it fails, then implement**

```typescript
// src/romanize/clean.ts
export class RomanizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RomanizeError";
  }
}

/**
 * Strips everything except Unicode letters (\p{L}), combining marks (\p{M} --
 * vowel signs, virama, nukta, anusvara etc. are marks, not letters, and must
 * be kept), and apostrophe. Mirrors the existing package's Latin-text
 * cleaning convention (README: `w.replace(/[^\w']/g, "")`) but Unicode-aware
 * so it doesn't mangle native scripts.
 */
export function cleanNativeWord(word: string): string {
  const cleaned = word.replace(/[^\p{L}\p{M}']/gu, "");
  if (cleaned.length === 0) {
    throw new RomanizeError(
      `cleanNativeWord: "${word}" has no alphabetic content after stripping punctuation`
    );
  }
  return cleaned;
}
```

- [ ] **Step 7: Run both test files, verify pass**

Run: `npx vitest run test/romanize/scriptDetect.test.ts test/romanize/clean.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/romanize/scriptDetect.ts src/romanize/clean.ts test/romanize
git commit -m "feat: script detection + native-word cleaning for romanization"
```

---

## Task 3: Core Brahmic abugida engine, proven against Devanagari/Hindi

This is the highest-risk task in the plan — get this right and Tasks 4–7 (7 of the remaining 8 Brahmic scripts) are mostly data-wiring. Read `scripts/prototype-brahmic-reference.mjs` first; this task is that algorithm, cleaned up, typed, and with the two bugs it already had fixed applied (virama must permanently resolve the *preceding* consonant's vowel, not just consume itself; only `Lo`/`Lu`/`Ll`-category characters are default-vowel candidates, never marks like anusvara even when their target looks consonant-only).

**Files:**
- Create: `src/romanize/brahmicData.ts`
- Create: `src/romanize/brahmic.ts`
- Test: `test/romanize/brahmic.hindi.test.ts`

**Interfaces:**
- Consumes: `ScriptName` from `./scriptDetect`, `RomanizeError` from `./clean`, JSON files in `./data/`.
- Produces:
  - `type BrahmicScript = "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Oriya" | "Tamil" | "Telugu" | "Kannada" | "Malayalam"`
  - `loadBrahmicScriptData(script: BrahmicScript): BrahmicScriptData` (typed loader)
  - `romanizeBrahmicWord(word: string, script: BrahmicScript, lcode: string): string`

- [ ] **Step 1: Write the failing test, using the real golden-word fixtures for Hindi**

```typescript
// test/romanize/brahmic.hindi.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Hindi (hin, Devanagari)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "hi");

  it("has test cases loaded from the fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`romanizes "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Devanagari", c.lcode)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/romanize/brahmic.hindi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the typed data loader**

```typescript
// src/romanize/brahmicData.ts
import devanagari from "./data/devanagari.json";
import bengali from "./data/bengali.json";
import gurmukhi from "./data/gurmukhi.json";
import gujarati from "./data/gujarati.json";
import oriya from "./data/oriya.json";
import tamil from "./data/tamil.json";
import telugu from "./data/telugu.json";
import kannada from "./data/kannada.json";
import malayalam from "./data/malayalam.json";
import type { BrahmicScript } from "./brahmic";

export interface BrahmicScriptData {
  defaultVowel: string;
  virama: string | null;
  vowelSigns: Record<string, string>;
  chars: Record<string, string>;
  categories: Record<string, string>;
  multiCharOverrides: Record<string, string>;
}

const DATA: Record<BrahmicScript, BrahmicScriptData> = {
  Devanagari: devanagari as BrahmicScriptData,
  Bengali: bengali as BrahmicScriptData,
  Gurmukhi: gurmukhi as BrahmicScriptData,
  Gujarati: gujarati as BrahmicScriptData,
  Oriya: oriya as BrahmicScriptData,
  Tamil: tamil as BrahmicScriptData,
  Telugu: telugu as BrahmicScriptData,
  Kannada: kannada as BrahmicScriptData,
  Malayalam: malayalam as BrahmicScriptData,
};

export function loadBrahmicScriptData(script: BrahmicScript): BrahmicScriptData {
  return DATA[script];
}
```

- [ ] **Step 4: Implement the abugida engine**

```typescript
// src/romanize/brahmic.ts
import { loadBrahmicScriptData } from "./brahmicData";
import { RomanizeError } from "./clean";

export type BrahmicScript =
  | "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Oriya"
  | "Tamil" | "Telugu" | "Kannada" | "Malayalam";

const CONSONANT_ONLY = /^[bcdfghjklmnpqrstvwxyz]+$/;

interface Unit {
  rom: string;
  /** Still a bare consonant awaiting a default-vowel decision. Becomes false
   * once resolved by a vowel sign, a virama, or the final default-vowel pass. */
  pending: boolean;
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

export function romanizeBrahmicWord(word: string, script: BrahmicScript, lcode: string): string {
  const data = loadBrahmicScriptData(script);
  const { chars, categories, vowelSigns, virama, multiCharOverrides, defaultVowel } = data;

  const multiKeys = Object.keys(multiCharOverrides).sort((a, b) => b.length - a.length);
  const codepoints = Array.from(word);
  const units: Unit[] = [];

  let i = 0;
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
      units.push({ rom: matchedRom, pending: CONSONANT_ONLY.test(matchedRom) });
      i += matchedLen;
      continue;
    }

    const c = codepoints[i];

    if (virama !== null && c === virama) {
      const prev = units[units.length - 1];
      if (prev?.pending) prev.pending = false; // permanently: no vowel, ever
      i += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(vowelSigns, c)) {
      const prev = units[units.length - 1];
      if (prev?.pending) {
        prev.rom += vowelSigns[c];
        prev.pending = false;
      } else {
        units.push({ rom: vowelSigns[c], pending: false });
      }
      i += 1;
      continue;
    }

    const rawRom = chars[c];
    if (rawRom === undefined) {
      // Chandrabindu (nasalization mark) is absent from uroman's own
      // per-script auto-table entirely -- see plan Task-list "Known gaps" #2.
      if (/CANDRABINDU/i.test(c) === false && isCandrabinduChar(c)) {
        units.push({ rom: "n", pending: false });
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
    const rom = rawRom.startsWith("+") ? rawRom.slice(1) : rawRom;
    const isLetter = (categories[c] ?? "").startsWith("L");
    units.push({ rom, pending: isLetter && CONSONANT_ONLY.test(rom) });
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
    } else if (deletesFinalSchwa(script, lcode)) {
      out += u.rom;
    } else {
      out += u.rom + defaultVowel;
    }
  }
  return out;
}

// Placeholder codepoint check for candrabindu -- see Task 5, which gives this
// a real implementation once Bengali/Oriya test cases are in place. Devanagari
// candrabindu is U+0951..U+0952 range historically but varies by script; do
// not guess here, resolve empirically against fixtures in Task 5.
function isCandrabinduChar(_c: string): boolean {
  return false;
}
```

Note the `isCandrabinduChar` stub: this task's scope is proving the engine against Hindi, which doesn't exercise candrabindu. Leave it returning `false` (falls through to the thrown error) here — Task 5 gives it a real body once there's a failing Bengali/Assamese test to drive it.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/romanize/brahmic.hindi.test.ts`
Expected: PASS on all Hindi cases. If any fail, this is the most important debugging in the whole plan — do not patch around a mismatch with a special case until you've confirmed via a fresh uroman clone (`python -c "import uroman; print(uroman.Uroman().romanize_string('<word>', lcode='hin'))"`) exactly what the correct target is and why.

- [ ] **Step 6: Commit**

```bash
git add src/romanize/brahmicData.ts src/romanize/brahmic.ts test/romanize/brahmic.hindi.test.ts
git commit -m "feat: core Brahmic abugida romanization engine, validated on Hindi"
```

---

## Task 4: Extend to the rest of the Devanagari family (mar, nep, san, mai, doi, kok, brx)

**Files:**
- Test: `test/romanize/brahmic.devanagariFamily.test.ts`
- Modify: `src/romanize/brahmic.ts` only if a genuine bug (not a special-case patch) is found.

**Interfaces:**
- Consumes: `romanizeBrahmicWord` from Task 3, unchanged signature.

- [ ] **Step 1: Write the failing test across all 7 remaining Devanagari-family languages**

```typescript
// test/romanize/brahmic.devanagariFamily.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Devanagari family (mar, nep, san, mai, doi, kok, brx)", () => {
  const langs = ["mr", "ne", "sa", "mai", "doi", "kok", "brx"];
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => langs.includes(c.lang));

  it("has test cases for all 7 languages", () => {
    const covered = new Set(cases.map((c) => c.lang));
    for (const l of langs) expect(covered.has(l)).toBe(true);
  });

  for (const c of cases) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Devanagari", c.lcode)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 2: Run and triage failures**

Run: `npx vitest run test/romanize/brahmic.devanagariFamily.test.ts`

Since the engine is script-driven (not per-lcode-hardcoded, except in `deletesFinalSchwa`), most of these should pass immediately — the engine doesn't know or care that it's romanizing Marathi vs Hindi, only that it's Devanagari. Expected failure: the Sanskrit (`san`) cases must show the *schwa kept* (e.g. `सुन्दरम्` → `sundaram`, not `sundara`), proving the lcode exception in `deletesFinalSchwa` actually engages. Expected known failure per this plan's "Known gaps" #5: the single Dogri case `अज्ज` → `ajja`.

- [ ] **Step 3: Investigate the Dogri anomaly**

```bash
git clone https://github.com/isi-nlp/uroman /tmp/uroman-verify
grep -n "ज्ज" /tmp/uroman-verify/uroman/data/romanization-table.txt
```

If this finds a geminate-cluster override entry (e.g. `::s ज्ज ::t jja`), add it: re-run `scripts/extract-uroman-data.py` (it already captures multi-char exceptions-table entries into `multiCharOverrides` automatically — no code change needed, just re-run the extractor and it should show up for Devanagari). If nothing is found there, search more broadly (`grep -rn "ज्ज" /tmp/uroman-verify/uroman/`) before concluding this is a genuine one-off inconsistency in upstream uroman itself worth a `// known upstream quirk` comment and a hardcoded fixture-only exception — don't invent a general rule from a single data point.

- [ ] **Step 4: Run to verify all pass**

Run: `npx vitest run test/romanize/brahmic.devanagariFamily.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/romanize/brahmic.devanagariFamily.test.ts src/romanize/data/devanagari.json
git commit -m "test: validate romanization engine across full Devanagari language family"
```

---

## Task 5: Bengali and Assamese

**Files:**
- Test: `test/romanize/brahmic.bengali.test.ts`
- Modify: `src/romanize/brahmic.ts` (give `isCandrabinduChar` a real body)

**Interfaces:**
- Consumes: `romanizeBrahmicWord`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/romanize/brahmic.bengali.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Bengali script (ben, asm)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "bn" || c.lang === "as");

  for (const c of cases) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Bengali", c.lcode)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 2: Run, expect the known failures from this plan's "Known gaps" #2 and #4**

Run: `npx vitest run test/romanize/brahmic.bengali.test.ts`
Expected failures: `পালোঁ` (candrabindu, currently throws `RomanizeError`), `পেয়েছি`/`লেগেছে` (chh-cluster), `এবং` (word-final anusvara context).

- [ ] **Step 3: Implement candrabindu handling**

Check the actual codepoint in a fresh uroman clone or via Node directly:

```bash
node -e 'console.log([..."পালোঁ"].map(c => c.codePointAt(0).toString(16)))'
```

The last codepoint before end-of-string is Bengali's candrabindu (U+0981). Give `isCandrabinduChar` (in `src/romanize/brahmic.ts`) a real implementation:

```typescript
function isCandrabinduChar(c: string): boolean {
  const cp = c.codePointAt(0)!;
  // CANDRABINDU is always the first combining mark in each Brahmic script's
  // Unicode block (immediately after the block's vowel-sign range starts);
  // confirmed codepoints: Devanagari U+0901, Bengali U+0981, Gurmukhi U+0A01,
  // Gujarati U+0A81, Oriya U+0B01. Verify against
  // https://www.unicode.org/charts/ for any script not listed here before
  // relying on this for it.
  return [0x0901, 0x0981, 0x0a01, 0x0a81, 0x0b01].includes(cp);
}
```

Wire it in properly (the current Task 3 code has a dead/inverted condition — fix it):

```typescript
    const rawRom = chars[c];
    if (rawRom === undefined) {
      if (isCandrabinduChar(c)) {
        units.push({ rom: "n", pending: false });
        i += 1;
        continue;
      }
      throw new RomanizeError(/* ... as before ... */);
    }
```

- [ ] **Step 4: Investigate the chh-cluster and word-final anusvara cases**

```bash
node -e '
const data = require("./src/romanize/data/bengali.json");
console.log("chars[ছ]:", data.chars["ছ"], "cat:", data.categories["ছ"]);
'
grep -n "ছ" /tmp/uroman-verify/uroman/data/romanization-table.txt
grep -n "BENGALI LETTER CHA\b" /tmp/uroman-verify/uroman/data/romanization-auto-table.txt
```

Compare what the exceptions table vs. auto-table say for this character (and any multi-char conjunct entries involving it) — the auto-table single-char value may not be what real uroman actually selects for this position, in which case the fix belongs in the extraction script's precedence handling, not a Bengali-specific patch. For the anusvara/`ebang` case: per this plan's "Known gaps" #4, first check whether this recurs across a wider fixture set (Task 14) before writing any lcode-specific rule for it — one example is not enough evidence to generalize from.

- [ ] **Step 5: Run to verify all pass (or are explicitly, individually understood and accepted)**

Run: `npx vitest run test/romanize/brahmic.bengali.test.ts`
Expected: PASS. If the anusvara-context case remains unresolved after genuine investigation, mark it `it.todo(...)` with a comment linking to this plan's "Known gaps" #4 rather than silently deleting the case — do not leave a real accuracy gap untracked.

- [ ] **Step 6: Commit**

```bash
git add src/romanize/brahmic.ts test/romanize/brahmic.bengali.test.ts
git commit -m "feat: candrabindu handling; validate romanization engine on Bengali/Assamese"
```

---

## Task 6: Gurmukhi (Punjabi) — ADDAK gemination

**Files:**
- Test: `test/romanize/brahmic.gurmukhi.test.ts`
- Modify: `src/romanize/brahmic.ts`

**Interfaces:**
- Consumes: `romanizeBrahmicWord`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/romanize/brahmic.gurmukhi.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Gurmukhi (pan)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "pa");

  for (const c of cases) {
    it(`"${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Gurmukhi", c.lcode)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 2: Run, expect the known ADDAK failure**

Run: `npx vitest run test/romanize/brahmic.gurmukhi.test.ts`
Expected failure: `ਅੱਜ` → currently something wrong (the ADDAK mark U+0A71 either falls through to raw passthrough or matches a stray table entry) instead of `ajja`.

- [ ] **Step 3: Implement ADDAK handling**

ADDAK (ੱ, U+0A71) doubles the *following* consonant — it's a prefix-gemination marker, structurally different from every other mark handled so far (which all modify the *preceding* unit). Handle it as a lookahead when building units:

```typescript
    if (c === "\u0A71") { // GURMUKHI SIGN ADDAK
      const nextC = codepoints[i + 1];
      const nextRom = nextC !== undefined ? chars[nextC] : undefined;
      if (nextRom !== undefined) {
        const cleanNext = nextRom.startsWith("+") ? nextRom.slice(1) : nextRom;
        const isLetter = (categories[nextC] ?? "").startsWith("L");
        // Emit the doubled consonant as its own resolved (non-pending) unit,
        // then skip the following character since we've already consumed it.
        units.push({ rom: cleanNext, pending: isLetter && CONSONANT_ONLY.test(cleanNext) });
        i += 2;
        continue;
      }
    }
```

Place this check right after the virama check and before the vowel-sign check in the main loop.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/romanize/brahmic.gurmukhi.test.ts`
Expected: PASS. Trace through `ਅੱਜ` by hand if it doesn't: ਅ(a, independent vowel) + ੱ(ADDAK, doubles next) + ਜ(ja) → should produce `a` + `j` (from the ADDAK-doubling push, still pending) + then falls to end-of-word default-vowel logic same as any bare consonant → with `pan` in the delete-list, single-syllable-check applies (`units.length` here is 2: `a`,`j` — not 1 — so schwa deletion should fire)... but expected output is `ajja` (vowel kept, AND doubled j). Re-examine: ADDAK gemination likely means the marked consonant appears **twice** in the output (once closed, once with whatever vowel follows) — i.e. `ਜ` after ADDAK should contribute a closed `j` AND the normal `ਜ` still contributes its own normal (possibly voweled) unit. Adjust the implementation to push **two** units (a resolved bare `j`, then let the normal per-character loop continue processing the same `ਜ` character again for its normal vowel-bearing contribution) rather than consuming it. Validate against the fixture, not against this description — the fixture is ground truth.

- [ ] **Step 5: Commit**

```bash
git add src/romanize/brahmic.ts test/romanize/brahmic.gurmukhi.test.ts
git commit -m "feat: Gurmukhi ADDAK gemination handling"
```

---

## Task 7: Gujarati and Oriya

**Files:**
- Test: `test/romanize/brahmic.gujaratiOriya.test.ts`

**Interfaces:**
- Consumes: `romanizeBrahmicWord`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/romanize/brahmic.gujaratiOriya.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Gujarati (guj) and Oriya (ori)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "gu" || c.lang === "od");

  for (const c of cases) {
    const script = c.lang === "gu" ? "Gujarati" : "Oriya";
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, script as any, c.lcode)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 2: Run and triage**

Run: `npx vitest run test/romanize/brahmic.gujaratiOriya.test.ts`
Expected known failure: `ମୁଁ` (Oriya candrabindu) — should already be fixed by Task 5's `isCandrabinduChar` including `0x0b01` (Oriya). If it still fails, double check the actual codepoint via `node -e 'console.log([..."ମୁଁ"].map(c=>c.codePointAt(0).toString(16)))'` — don't assume the codepoint list in Task 5 is complete, verify it.

- [ ] **Step 3: Fix any remaining failures, verify pass**

Run: `npx vitest run test/romanize/brahmic.gujaratiOriya.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/romanize/brahmic.gujaratiOriya.test.ts src/romanize/brahmic.ts
git commit -m "test: validate romanization engine on Gujarati and Oriya"
```

---

## Task 8: Telugu, Kannada, Malayalam

**Files:**
- Test: `test/romanize/brahmic.teluguKannadaMalayalam.test.ts`

**Interfaces:**
- Consumes: `romanizeBrahmicWord`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/romanize/brahmic.teluguKannadaMalayalam.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Telugu (tel), Kannada (kan), Malayalam (mal)", () => {
  const scriptFor: Record<string, string> = { te: "Telugu", kn: "Kannada", ml: "Malayalam" };
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => ["te", "kn", "ml"].includes(c.lang));

  for (const c of cases) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, scriptFor[c.lang] as any, c.lcode)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 2: Run and triage**

Run: `npx vitest run test/romanize/brahmic.teluguKannadaMalayalam.test.ts`

By this point in the prototype, this set was passing (Telugu/Kannada fully; Malayalam had one candrabindu-adjacent case that Task 5's fix should also resolve, e.g. `ഞാൻ`). Check specifically for Malayalam **chillu letters** (ൻ, ൺ, ൽ, ൾ, ർ — consonant-only forms unique to Malayalam, written without an inherent vowel by design, no virama needed) — these were not exercised by the fixture set used during prototyping and may be missing from the extracted `malayalam.json` char table (they're regular Unicode codepoints in the Malayalam block, U+0D7A-U+0D7F, so check whether `UnicodeDataProps.txt`'s Malayalam `::char` list includes them; if not, they need to be added as always-non-pending "already resolved" entries since they never take a default vowel).

- [ ] **Step 3: Fix any failures, verify pass**

Run: `npx vitest run test/romanize/brahmic.teluguKannadaMalayalam.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/romanize/brahmic.teluguKannadaMalayalam.test.ts src/romanize/brahmic.ts src/romanize/data/malayalam.json
git commit -m "test: validate romanization engine on Telugu, Kannada, Malayalam"
```

---

## Task 9: Tamil (dedicated — the hardest script in scope)

**Files:**
- Test: `test/romanize/brahmic.tamil.test.ts`
- Modify: `src/romanize/brahmic.ts` or a new `src/romanize/tamilCoda.ts` if the fix is Tamil-specific enough to warrant isolating it from the shared engine.
- Modify: `src/romanize/data/tamil.json` if extraction needs a Tamil-specific pass.

**Interfaces:**
- Consumes: `romanizeBrahmicWord`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/romanize/brahmic.tamil.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Tamil (tam)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "ta");

  for (const c of cases) {
    it(`"${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Tamil", c.lcode)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 2: Run and confirm the known failure pattern**

Run: `npx vitest run test/romanize/brahmic.tamil.test.ts`
Expected: 5 of 9 cases fail, all showing spurious repeated consonants (e.g. `இன்று` → `innnrru` instead of `inru`). This is this plan's "Known gaps" #1.

- [ ] **Step 3: Investigate uroman's actual syllable-position mechanism**

```bash
sed -n '1300,1420p' /tmp/uroman-verify/uroman/uroman.py   # is_at_end_of_syllable
grep -n "t-end-of-syllable\|t-at-end-of-syllable" /tmp/uroman-verify/uroman/uroman.py
grep -n "TAMIL LETTER NNNA\|TAMIL LETTER RA\b\|TAMIL LETTER RRA\b" /tmp/uroman-verify/uroman/data/romanization-auto-table.txt
```

Confirm the hypothesis from prototyping: Tamil disambiguates ந/ண/ன 's dental/retroflex/alveolar nasals via `n`/`nn`/`nnn` in *onset* (vowel-bearing) position, but uses a shorter target in *coda* position (immediately before virama) and in geminate clusters (consonant+virama+same-consonant, e.g. ற்ற). Determine exactly what "coda position" target each affected Tamil letter uses — do not guess; if `t-end-of-syllable` is a per-entry field in the auto-table for these specific characters, extend `scripts/extract-uroman-data.py` to capture it (add a `codaTarget` field to the per-script JSON, sourced from that field when present), and extend `romanizeBrahmicWord`'s virama-handling branch to use `codaTarget` (falling back to the normal target) for the unit immediately preceding a virama.

- [ ] **Step 4: Implement the fix**

The exact shape depends on Step 3's findings, but the mechanism will be: when the virama-handling branch (in `romanizeBrahmicWord`) resolves the *preceding* unit's `pending` flag to `false`, it currently keeps that unit's `rom` unchanged. For Tamil (and only where a `codaTarget` exists for that character), it should instead **replace** `rom` with `codaTarget` at that point:

```typescript
    if (virama !== null && c === virama) {
      const prev = units[units.length - 1];
      if (prev?.pending) {
        prev.pending = false;
        if (prev.codaTarget !== undefined) prev.rom = prev.codaTarget;
      }
      i += 1;
      continue;
    }
```

(This requires threading a `codaTarget` field through from the char lookup into the `Unit` interface for the character that produced it — do this generically in `brahmic.ts`, not as a Tamil-only branch, since it costs nothing for scripts where no character has a `codaTarget` and may turn out to matter for other scripts later.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/romanize/brahmic.tamil.test.ts`
Expected: PASS on all 9 cases. If genuine cases remain unresolved after real investigation (not just time pressure), do not ship Tamil with `it.todo` placeholders silently — this violates the zero-compromise-on-accuracy constraint. Escalate: either the fix needs more of uroman's actual candidate-ranking engine ported (the `n-restr`/`simple_top_romanization_candidate_for_span` mechanism, `uroman.py` lines ~1760-1800), or Tamil needs to fall back to calling into a small bundled subset of uroman's actual logic rather than this plan's simplified model. Flag this explicitly rather than shipping a silently-inaccurate Tamil path.

- [ ] **Step 6: Expand Tamil fixture coverage before calling this done**

The 9 test cases here all come from one source sentence. Given Tamil is the highest-risk script, generate at least 10 more real Tamil sentences' worth of per-word fixtures (reuse `scripts/gen-perword-fixtures.py`'s pattern — add entries to a `samples` list with fresh Tamil sentences covering different vocabulary, then regenerate) before considering Tamil accuracy-verified.

- [ ] **Step 7: Commit**

```bash
git add src/romanize/brahmic.ts src/romanize/data/tamil.json scripts/extract-uroman-data.py test/romanize/brahmic.tamil.test.ts
git commit -m "feat: Tamil coda/geminate consonant handling"
```

---

## Task 10: Perso-Arabic (Urdu, Kashmiri, Sindhi)

This is a separate, much simpler engine — Perso-Arabic is an abjad (no inherent-vowel/virama/vowel-sign machinery), and uroman's own table (`src/romanize/data/arabic.json`, already extracted) is a flat, context-free character substitution with no lcode branching at all (confirmed: `grep -n "lcode" romanization-table-arabic-block.txt` finds nothing).

**Files:**
- Create: `src/romanize/persoArabic.ts`
- Test: `test/romanize/persoArabic.test.ts`
- Create: `scripts/gen-perword-fixtures-arabic.py` (the existing `golden-words.json` only covers Brahmic scripts — see Task list intro)

**Interfaces:**
- Produces: `romanizePersoArabicWord(word: string): string`

- [ ] **Step 1: Generate per-word Perso-Arabic fixtures**

```python
# scripts/gen-perword-fixtures-arabic.py
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
```

Run it (needs `pip install uroman` and `test/fixtures/romanize/golden-sentences.json`, both already available):

```bash
python scripts/gen-perword-fixtures-arabic.py
```

- [ ] **Step 2: Write the failing test**

```typescript
// test/romanize/persoArabic.test.ts
import { describe, it, expect } from "vitest";
import { romanizePersoArabicWord } from "../../src/romanize/persoArabic";
import goldenWords from "../fixtures/romanize/golden-words-arabic.json";

describe("romanizePersoArabicWord", () => {
  for (const c of goldenWords as Array<{ lang: string; word: string; uroman: string }>) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizePersoArabicWord(c.word)).toBe(c.uroman);
    });
  }
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/romanize/persoArabic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```typescript
// src/romanize/persoArabic.ts
import arabicData from "./data/arabic.json";
import { RomanizeError } from "./clean";

const CHARS: Record<string, string> = arabicData.chars;

/**
 * Perso-Arabic is an abjad -- no virama/vowel-sign/default-vowel machinery
 * like the Brahmic engine needs. uroman's own table (src/romanize/data/
 * arabic.json, extracted from romanization-table-arabic-block.txt) is a flat,
 * context-free character substitution, confirmed via that file having no
 * lcode-specific branching -- the same table serves Urdu, Kashmiri, Sindhi.
 * Unicode Arabic text is stored in logical (unshaped) order, so no
 * positional letter-form handling is needed either.
 */
export function romanizePersoArabicWord(word: string): string {
  let out = "";
  for (const c of word) {
    const rom = CHARS[c];
    if (rom === undefined) {
      throw new RomanizeError(
        `romanizePersoArabicWord: no romanization data for character U+${c
          .codePointAt(0)!
          .toString(16)
          .toUpperCase()} ("${c}") in word "${word}".`
      );
    }
    out += rom;
  }
  return out;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/romanize/persoArabic.test.ts`
Expected: PASS. If specific characters fail, check whether they're harakat diacritics or extended letters that didn't make it into `arabic.json` — re-run `scripts/extract-uroman-data.py` if the source table has since been extended, or check for typos in the extraction's Arabic-block file path.

- [ ] **Step 6: Commit**

```bash
git add src/romanize/persoArabic.ts test/romanize/persoArabic.test.ts scripts/gen-perword-fixtures-arabic.py test/fixtures/romanize/golden-words-arabic.json
git commit -m "feat: Perso-Arabic romanization for Urdu/Kashmiri/Sindhi"
```

---

## Task 11: Public romanization API — `romanizeWord` / `romanizeWords`

**Files:**
- Create: `src/romanize/lcodes.ts`
- Create: `src/romanize/index.ts`
- Test: `test/romanize/index.test.ts`

**Interfaces:**
- Consumes: `detectScript` (Task 2), `cleanNativeWord`/`RomanizeError` (Task 2), `romanizeBrahmicWord` (Task 3), `romanizePersoArabicWord` (Task 10).
- Produces:
  - `type LanguageCode` — the 20 supported BCP-47 codes, e.g. `"hi-IN" | "bn-IN" | ...`
  - `SUPPORTED_LANGUAGE_CODES: LanguageCode[]`
  - `romanizeWord(word: string, langCode: LanguageCode): string`
  - `romanizeWords(words: string[], langCode: LanguageCode): string[]`
  - Re-exports `RomanizeError`.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/romanize/index.test.ts
import { describe, it, expect } from "vitest";
import { romanizeWord, romanizeWords, RomanizeError, SUPPORTED_LANGUAGE_CODES } from "../../src/romanize";
import goldenSentences from "../fixtures/romanize/golden-sentences.json";

describe("romanizeWord", () => {
  it("romanizes a Hindi word", () => {
    expect(romanizeWord("आज", "hi-IN")).toBe("aaj");
  });

  it("passes through an already-Latin word (lowercased)", () => {
    expect(romanizeWord("Hello", "hi-IN")).toBe("hello");
  });

  it("throws RomanizeError for a script that doesn't match the given language", () => {
    expect(() => romanizeWord("আজ", "hi-IN")).toThrow(RomanizeError);
  });

  it("supports exactly the 20 documented languages", () => {
    expect(SUPPORTED_LANGUAGE_CODES.sort()).toEqual(
      [
        "hi-IN", "mr-IN", "ne-IN", "sa-IN", "mai-IN", "doi-IN", "kok-IN", "brx-IN",
        "bn-IN", "as-IN", "pa-IN", "gu-IN", "od-IN",
        "ta-IN", "te-IN", "kn-IN", "ml-IN",
        "ur-IN", "ks-IN", "sd-IN",
        "en-IN",
      ].sort()
    );
  });
});

describe("romanizeWords: word-count invariant", () => {
  it("returns exactly one output word per input word, in order", () => {
    const words = ["आज", "मैंने", "काफी", "किया"];
    const result = romanizeWords(words, "hi-IN");
    expect(result).toHaveLength(words.length);
  });

  it("throws rather than dropping a word it can't romanize", () => {
    expect(() => romanizeWords(["आज", "।।।"], "hi-IN")).toThrow(RomanizeError);
  });
});

describe("romanizeWords: matches real uroman output on full golden sentences", () => {
  const langToBcp47: Record<string, string> = {
    hi: "hi-IN", mr: "mr-IN", ne: "ne-IN", sa: "sa-IN", mai: "mai-IN", doi: "doi-IN",
    kok: "kok-IN", bn: "bn-IN", as: "as-IN", pa: "pa-IN", gu: "gu-IN", od: "od-IN",
    ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", ur: "ur-IN", ks: "ks-IN",
    sd: "sd-IN", brx: "brx-IN", en: "en-IN",
  };

  for (const fx of goldenSentences as Array<{ lang: string; input: string; uroman_output: string }>) {
    const bcp47 = langToBcp47[fx.lang];
    if (!bcp47) continue; // sat, mni out of scope
    it(`[${fx.lang}] full sentence matches real uroman (modulo punctuation stripping)`, () => {
      const words = fx.input.split(/\s+/).map((w) => w.replace(/[।॥.,!?؟،؛]+$/gu, "")).filter(Boolean);
      const expectedWords = fx.uroman_output.split(/\s+/).map((w) => w.replace(/[.,!?]+$/g, "")).filter(Boolean);
      expect(romanizeWords(words, bcp47 as any)).toEqual(expectedWords);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/romanize/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the BCP-47 → (script, lcode) mapping**

```typescript
// src/romanize/lcodes.ts
import type { BrahmicScript } from "./brahmic";
import type { ScriptName } from "./scriptDetect";

export type LanguageCode =
  | "hi-IN" | "mr-IN" | "ne-IN" | "sa-IN" | "mai-IN" | "doi-IN" | "kok-IN" | "brx-IN"
  | "bn-IN" | "as-IN"
  | "pa-IN"
  | "gu-IN"
  | "od-IN"
  | "ta-IN"
  | "te-IN"
  | "kn-IN"
  | "ml-IN"
  | "ur-IN" | "ks-IN" | "sd-IN"
  | "en-IN";

interface LangInfo {
  lcode: string; // ISO 639-3, matches uroman's convention and this repo's data
  script: ScriptName;
}

// Verified against real uroman output (test/fixtures/romanize/golden-sentences.json)
// for all 20 -- see plan Global Constraints for the full mapping rationale.
const LANG_INFO: Record<LanguageCode, LangInfo> = {
  "hi-IN": { lcode: "hin", script: "Devanagari" },
  "mr-IN": { lcode: "mar", script: "Devanagari" },
  "ne-IN": { lcode: "nep", script: "Devanagari" },
  "sa-IN": { lcode: "san", script: "Devanagari" },
  "mai-IN": { lcode: "mai", script: "Devanagari" },
  "doi-IN": { lcode: "doi", script: "Devanagari" },
  "kok-IN": { lcode: "kok", script: "Devanagari" },
  "brx-IN": { lcode: "brx", script: "Devanagari" },
  "bn-IN": { lcode: "ben", script: "Bengali" },
  "as-IN": { lcode: "asm", script: "Bengali" },
  "pa-IN": { lcode: "pan", script: "Gurmukhi" },
  "gu-IN": { lcode: "guj", script: "Gujarati" },
  "od-IN": { lcode: "ori", script: "Oriya" },
  "ta-IN": { lcode: "tam", script: "Tamil" },
  "te-IN": { lcode: "tel", script: "Telugu" },
  "kn-IN": { lcode: "kan", script: "Kannada" },
  "ml-IN": { lcode: "mal", script: "Malayalam" },
  "ur-IN": { lcode: "urd", script: "Arabic" },
  "ks-IN": { lcode: "kas", script: "Arabic" },
  "sd-IN": { lcode: "snd", script: "Arabic" },
  "en-IN": { lcode: "eng", script: "Latin" },
};

export const SUPPORTED_LANGUAGE_CODES = Object.keys(LANG_INFO) as LanguageCode[];

export function langInfo(code: LanguageCode): LangInfo {
  return LANG_INFO[code];
}

export function isBrahmicScript(script: ScriptName): script is BrahmicScript {
  return [
    "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya",
    "Tamil", "Telugu", "Kannada", "Malayalam",
  ].includes(script);
}
```

- [ ] **Step 4: Implement the public API**

```typescript
// src/romanize/index.ts
import { detectScript } from "./scriptDetect";
import { cleanNativeWord, RomanizeError } from "./clean";
import { romanizeBrahmicWord } from "./brahmic";
import { romanizePersoArabicWord } from "./persoArabic";
import { langInfo, isBrahmicScript, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from "./lcodes";

export { RomanizeError, SUPPORTED_LANGUAGE_CODES };
export type { LanguageCode };

export function romanizeWord(word: string, langCode: LanguageCode): string {
  const { lcode, script: expectedScript } = langInfo(langCode);
  const cleaned = cleanNativeWord(word);

  if (expectedScript === "Latin") {
    // en-IN: expect already-Latin text; still route through detectScript so
    // a caller accidentally passing native-script text under "en-IN" gets a
    // loud error instead of silently mangled output.
    const detected = detectScript(cleaned);
    if (detected !== "Latin") {
      throw new RomanizeError(
        `romanizeWord: expected Latin script for language "en-IN", got ${detected} in word "${word}"`
      );
    }
    return cleaned.toLowerCase();
  }

  const detected = detectScript(cleaned);
  if (detected === "Latin") {
    // Code-switched word (e.g. an English brand name inside an Indic
    // sentence) -- pass through rather than erroring.
    return cleaned.toLowerCase();
  }
  if (detected !== expectedScript) {
    throw new RomanizeError(
      `romanizeWord: word "${word}" is ${detected} script, expected ${expectedScript} for language "${langCode}"`
    );
  }

  if (isBrahmicScript(expectedScript)) {
    return romanizeBrahmicWord(cleaned, expectedScript, lcode);
  }
  if (expectedScript === "Arabic") {
    return romanizePersoArabicWord(cleaned);
  }
  throw new RomanizeError(`romanizeWord: unsupported script ${expectedScript} for language "${langCode}"`);
}

export function romanizeWords(words: string[], langCode: LanguageCode): string[] {
  const out = words.map((w) => romanizeWord(w, langCode));
  if (out.length !== words.length) {
    // Unreachable given .map()'s semantics, but the invariant is load-bearing
    // enough (see plan Global Constraints: "zero word loss is non-negotiable")
    // to assert explicitly rather than trust .map() silently forever.
    throw new RomanizeError(
      `romanizeWords: word count mismatch, got ${out.length} outputs for ${words.length} inputs`
    );
  }
  return out;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/romanize/index.test.ts`
Expected: PASS. The full-sentence golden tests are the strongest signal in the whole plan — if any of these fail, it means a per-language task above has a gap that its own narrower test didn't catch (e.g. a punctuation-stripping edge case). Fix at the root cause, not by adjusting this test's expectations.

- [ ] **Step 6: Commit**

```bash
git add src/romanize/lcodes.ts src/romanize/index.ts test/romanize/index.test.ts
git commit -m "feat: public romanizeWord/romanizeWords API across all 20 languages"
```

---

## Task 12: `alignNative()` — integration with the existing aligner

**Files:**
- Create: `src/alignNative.ts`
- Modify: `src/index.ts`
- Test: `test/alignNative.unit.test.ts`

**Interfaces:**
- Consumes: `Aligner`, `WordTiming` from `./align`; `romanizeWords`, `LanguageCode`, `RomanizeError` from `./romanize`.
- Produces: `alignNative(aligner: Aligner, waveform: Float32Array, sampleRate: number, nativeWords: string[], langCode: LanguageCode): Promise<WordTiming[]>`

- [ ] **Step 1: Write the failing unit test, using a stub Aligner (no real model/audio needed)**

```typescript
// test/alignNative.unit.test.ts
import { describe, it, expect, vi } from "vitest";
import { alignNative } from "../src/alignNative";
import type { Aligner, WordTiming } from "../src/align";

function stubAligner(): Aligner {
  return {
    async align(_waveform, _sampleRate, words): Promise<WordTiming[]> {
      // Echo back deterministic fake timings, one per word -- this test is
      // about the romanize -> align -> remap wiring, not real alignment.
      return words.map((w, i) => ({ word: w, start: i, end: i + 1 }));
    },
    async dispose() {},
  };
}

describe("alignNative", () => {
  it("returns timings with the ORIGINAL native-script words, not the romanized ones", async () => {
    const aligner = stubAligner();
    const waveform = new Float32Array(16000);
    const nativeWords = ["आज", "मैंने", "काफी"];

    const result = await alignNative(aligner, waveform, 16000, nativeWords, "hi-IN");

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.word)).toEqual(nativeWords);
  });

  it("preserves start/end timings from the underlying aligner", async () => {
    const aligner = stubAligner();
    const result = await alignNative(aligner, new Float32Array(16000), 16000, ["आज", "काफी"], "hi-IN");
    expect(result[0]).toMatchObject({ start: 0, end: 1 });
    expect(result[1]).toMatchObject({ start: 1, end: 2 });
  });

  it("passes the romanized (not native) words to the underlying aligner", async () => {
    const alignSpy = vi.fn(async (_w: Float32Array, _sr: number, words: string[]) =>
      words.map((w, i) => ({ word: w, start: i, end: i + 1 }))
    );
    const aligner: Aligner = { align: alignSpy, dispose: async () => {} };

    await alignNative(aligner, new Float32Array(16000), 16000, ["आज"], "hi-IN");

    expect(alignSpy).toHaveBeenCalledWith(expect.any(Float32Array), 16000, ["aaj"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/alignNative.unit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/alignNative.ts
import type { Aligner, WordTiming } from "./align";
import { AlignError } from "./align";
import { romanizeWords, type LanguageCode } from "./romanize";

/**
 * Aligns a native-script (non-Latin) transcript by romanizing it internally
 * (see src/romanize/), running the existing Aligner on the romanized words,
 * then remapping the result back onto the ORIGINAL native-script words by
 * index. Word count is guaranteed equal on both sides -- romanizeWords()
 * throws rather than ever dropping/merging a word (see romanize/index.ts).
 *
 * Reuse one Aligner across many calls, same as align() itself -- this
 * function does not create or own the Aligner.
 */
export async function alignNative(
  aligner: Aligner,
  waveform: Float32Array,
  sampleRate: number,
  nativeWords: string[],
  langCode: LanguageCode
): Promise<WordTiming[]> {
  const romanizedWords = romanizeWords(nativeWords, langCode);

  if (romanizedWords.length !== nativeWords.length) {
    // Belt-and-suspenders: romanizeWords() already guarantees this, but this
    // invariant is exactly what "zero word loss" means for this package --
    // never let a violation here surface as a silent mis-indexed result.
    throw new AlignError(
      `alignNative: romanization produced ${romanizedWords.length} words for ` +
        `${nativeWords.length} input words -- refusing to align with a mismatched count`
    );
  }

  const timings = await aligner.align(waveform, sampleRate, romanizedWords);

  return timings.map((t, i) => ({
    ...t,
    word: nativeWords[i],
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/alignNative.unit.test.ts`
Expected: PASS

- [ ] **Step 5: Export from the package's public API**

Modify `src/index.ts`:

```typescript
export { createAligner, AlignError } from "./align";
export type { Aligner, WordTiming, CreateAlignerOptions } from "./align";
export { VocabError } from "./vocab";
export { DecodeError } from "./decode";
export { alignNative } from "./alignNative";
export { romanizeWord, romanizeWords, RomanizeError, SUPPORTED_LANGUAGE_CODES } from "./romanize";
export type { LanguageCode } from "./romanize";
```

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:unit` (excludes the model-download/inference/golden tests that need the real ONNX model, per the existing `package.json` script — appropriate here since this task's tests are pure-unit)
Expected: PASS, including everything from Tasks 2–11.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/alignNative.ts src/index.ts test/alignNative.unit.test.ts
git commit -m "feat: alignNative() -- native-script alignment via internal romanization"
```

---

## Task 13: Optional end-to-end smoke test with the real model (only if real Indic audio is available)

This mirrors the existing package's `test/align.golden.test.ts` pattern (real model, excluded from `test:unit`, run separately). **Skip this task if no real Indic-language audio + verified transcript is on hand** — the per-word unit tests (Tasks 3–11, validated against real uroman output) and the wiring test (Task 12) already cover correctness of the romanization and the integration logic; this task only additionally proves the romanized text actually aligns sensibly against real speech, which needs real audio you don't currently have in this repo.

**Files:**
- Create: `test/alignNative.golden.test.ts` (only if audio is available)

**Interfaces:**
- Consumes: `alignNative`, `createAligner`.

- [ ] **Step 1: If real Indic audio + verified transcript is available, add it under `test/fixtures/` (respecting the existing `.gitignore` policy — audio and its generated fixtures are never bundled, see `test/fixtures/README.md`)**

- [ ] **Step 2: Write a golden test following the exact structure of `test/align.golden.test.ts`**, substituting `alignNative()` for `align()` and a native-script transcript for the existing Hinglish one. Assert word timings are monotonically increasing and cover the full clip duration, same tolerance approach as the existing golden test.

- [ ] **Step 3: Run it**

Run: `npx vitest run test/alignNative.golden.test.ts`

- [ ] **Step 4: Commit if added**

```bash
git add test/alignNative.golden.test.ts test/fixtures/README.md
git commit -m "test: add golden end-to-end test for alignNative()"
```

---

## Task 14: Expand fixture coverage and close out known gaps

**Files:**
- Modify: `scripts/gen-perword-fixtures.py` (add more sample sentences)
- Modify: `test/fixtures/romanize/golden-words.json` (regenerated, larger)
- Modify: relevant per-script test files if new failures surface

**Interfaces:** none new — this hardens existing coverage.

- [ ] **Step 1: Add 10-15 more real sentences per Brahmic language to the `samples` list in a copy of `scripts/gen_fixtures.py`'s pattern** (varied vocabulary — the current fixtures are all variations of "today I had a great experience," which under-exercises many characters/conjuncts). Prioritize Tamil and Bengali given this plan's known gaps.

- [ ] **Step 2: Regenerate `golden-words.json`**

```bash
pip install uroman  # if not already
python scripts/gen-perword-fixtures.py
```

- [ ] **Step 3: Run the full romanize test suite against the expanded fixtures**

Run: `npx vitest run test/romanize`
Expected: any new failures are new, real gaps — triage each one the same way as Tasks 4-9 (check uroman's actual source/data before writing a fix, never guess).

- [ ] **Step 4: Specifically re-check this plan's "Known gaps" #4 (Bengali word-final anusvara context) with the larger sample** — with more data points, either a real pattern will emerge (write the rule) or it won't (leave it as a documented, narrow, accepted gap with a comment citing this plan).

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-perword-fixtures.py test/fixtures/romanize/golden-words.json
git commit -m "test: expand romanization golden fixtures for broader coverage"
```

---

## Task 15: Documentation and package metadata

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:** none.

- [ ] **Step 1: Update the README's "Scope" section**

The current README lists under "Not yet supported": *"Non-Latin scripts requiring uroman-style romanization."* Replace this with an accurate description of the new capability — document `romanizeWord`/`romanizeWords`/`alignNative`, the 20 supported `LanguageCode` values, the explicit exclusion of Santali/Manipuri with the reason (uroman's own data for those two scripts is incomplete/unreliable), and a short usage example:

```typescript
import { createAligner, alignNative } from "mms-forced-align";

const aligner = await createAligner();
const timings = await alignNative(
  aligner,
  waveform,
  16000,
  ["आज", "मैंने", "काफी", "कुछ", "किया"],
  "hi-IN"
);
// [{ word: "आज", start: ..., end: ... }, ...] -- native-script words, real timings
```

Also document: romanization happens internally against uroman-derived data (cite `src/romanize/data/README.md` from Task 1), so `alignNative()`'s accuracy tracks uroman's own accuracy for a given language, not a hand-built approximation.

- [ ] **Step 2: Bump `package.json` version and update `keywords`**

Add `"indic-languages"`, `"romanization"`, `"hindi"`, `"devanagari"` to the `keywords` array. Bump version per semver — this is a backward-compatible feature addition (new exports only, no changes to existing `align()`/`createAligner()` signatures), so a minor version bump (e.g. `0.1.0` → `0.2.0`).

- [ ] **Step 3: Run the full test suite + build one more time as a final gate**

```bash
npm run typecheck
npm run test:unit
npm run build
```

Expected: all green, `dist/` produced without errors.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "docs: document Indic native-script romanization support"
```

---

## Self-review notes (from planning)

- **Spec coverage**: all 20 in-scope languages have a task; sat/mni explicitly excluded per product decision with reasoning captured in Global Constraints. Zero-word-loss is enforced at three layers (per-word throw in `romanizeWord`, count-check in `romanizeWords`, belt-and-suspenders count-check in `alignNative`) — deliberate redundancy given this is the single hardest constraint to violate silently.
- **Placeholder scan**: the only two intentionally-incomplete pieces of code in this plan are `isCandrabinduChar` (Task 3, explicitly filled in by Task 5 with a real body and a comment explaining why it's stubbed at that point) and Task 13 (explicitly conditional on audio availability, with clear instructions for both branches) — both are deliberate, explained sequencing decisions, not vague TODOs.
- **Type consistency**: `LanguageCode`, `ScriptName`, `BrahmicScript`, `WordTiming`, `Aligner` are defined once (Tasks 2, 3, 11, and pre-existing `align.ts` respectively) and reused by exact name in every later task — checked against each task's Interfaces block above.
