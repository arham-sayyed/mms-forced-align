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
  // Task 14: the apostrophe is Script=Common and must not make a native-script
  // word "Mixed" -- Bodo writes /ɯ/ with one (बर' = "Boro").
  it("detects Devanagari for a Bodo word with an apostrophe", () =>
    expect(detectScript("बर'")).toBe("Devanagari"));
  it("still detects Latin for a word that is only an apostrophe", () =>
    expect(detectScript("'")).toBe("Latin"));
  it("returns Unknown for a word with no letters", () => expect(detectScript("123")).toBe("Unknown"));
  it("returns Mixed for a word mixing two scripts", () => expect(detectScript("आजhi")).toBe("Mixed"));
});
