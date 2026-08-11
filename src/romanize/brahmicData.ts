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
  /** Chars whose Unicode name contains "VOCALIC" -- see brahmic.ts's
   * word-internal vocalic rule (uroman.py line 1732). */
  vocalicChars: string[];
  /** Chars whose Unicode name contains "NUKTA" -- see brahmic.ts's nukta
   * handling (uroman.py lines 1342 and 1710-1717). */
  nuktaChars: string[];
  /** Exactly the chars uroman's chr_script_name() assigns to this script.
   * Drives all three of uroman's script-gated abugida rules -- see the
   * `scriptSet` uses in brahmic.ts. Neither a subset nor a superset of
   * `chars`: it excludes script-neutral characters that romanize (ॐ, danda)
   * and includes script characters that don't (the nukta). */
  scriptChars: string[];
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
