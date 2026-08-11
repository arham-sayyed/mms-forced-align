# -*- coding: utf-8 -*-
import sys, json, re, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import uroman as ur

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.chdir("..")

u = ur.Uroman()

with open("test/fixtures/romanize/golden-sentences.json", encoding="utf-8") as f:
    fixtures = json.load(f)

# Extra Perso-Arabic source sentences, same rationale as the Brahmic
# generator's EXTRA_SAMPLES: golden-sentences.json has exactly one sentence
# per language and they are all the same sentence translated, which
# under-exercises the script. Added in Task 14.
EXTRA_SAMPLES = [
    ("ur", "urd", "اردو زبان بہت خوبصورت ہے۔"),
    ("ur", "urd", "آج موسم بہت اچھا ہے۔"),
    ("ur", "urd", "بچے اسکول میں پڑھ رہے ہیں۔"),
    ("ur", "urd", "کسان کھیتوں میں کام کر رہے ہیں۔"),
    ("ur", "urd", "مجھے میٹھا کھانا بہت پسند ہے۔"),
    ("ur", "urd", "سورج مشرق سے طلوع ہوتا ہے۔"),
    ("ur", "urd", "اس نے کتاب پڑھ کر ختم کی۔"),
    ("ur", "urd", "ہمارے گاؤں میں ہر سال بڑا میلہ لگتا ہے۔"),
    ("ur", "urd", "ریل گاڑی اسٹیشن پر وقت پر پہنچی۔"),
    ("ur", "urd", "والدہ باورچی خانے میں کھانا بنا رہی ہیں۔"),
    ("ur", "urd", "طلبہ امتحان کی تیاری کر رہے ہیں۔"),
    ("ur", "urd", "ایک اچھی کتاب انسان کی بہترین دوست ہوتی ہے۔"),
    ("sd", "snd", "سنڌي ٻولي تمام مٺي آهي."),
    ("sd", "snd", "اڄ موسم ڏاڍو سٺو آهي."),
    ("sd", "snd", "ٻار اسڪول ۾ پڙهن ٿا."),
    ("sd", "snd", "هاري ٻنيءَ ۾ ڪم ڪري رهيا آهن."),
    ("sd", "snd", "مون کي مٺاڻ کائڻ تمام گهڻو پسند آهي."),
    ("sd", "snd", "سج اوڀر کان اڀري ٿو."),
    ("sd", "snd", "ماءُ باورچي خاني ۾ ماني پچائي رهي آهي."),
    ("sd", "snd", "شاگرد امتحان جي تياري ڪري رهيا آهن."),
    ("ks", "kas", "کٲشُر زبان چھِ بۆڈ خوبصورت."),
    ("ks", "kas", "اَز چھُ موسم ښۇب."),
    ("ks", "kas", "شُر چھِ سکولس منٛز پرَن."),
    ("ks", "kas", "مےٚ چھُ مِٹھایی پسند."),
]

# Word-level probes for the one context-dependent rule in this engine:
# uroman's `::use-only-at-start-of-word` entry "ای" -> "i". Task 10's review
# established (against real uroman) that "start of word" is NOT literal index
# 0 -- it is a check on the character/romanization *immediately* before the
# position -- but that finding was verified with throwaway scripts and never
# captured as a fixture. These probe words close that gap permanently. Each
# is "ایک" (ek, "one") with one character prepended; the prepended character
# is what decides whether the override fires:
#
#   ایک          -> "ik"     baseline, literal index 0
#   ب + SUKUN + ایک -> "bik"  prev source char is a mark, prev rom is "" -> fires
#   ب + FATHA + ایک -> "baaik" prev rom is "a", alphabetic -> does NOT fire
#   ء + ایک      -> "'aik"   prev source char is a LETTER (even though its own
#                            romanization "'" is non-alphabetic) -> does NOT fire
#   HAMZA-ABOVE + ایک -> "'ik"  prev is a mark romanizing to "'" (non-alpha) -> fires
#   ١ + ایک      -> "1ik"    prev is a digit romanizing to "1" (non-alpha) -> fires
#
# The last two shapes are what a combining mark or digit immediately before a
# word does in real Kashmiri/Urdu text with diacritics.
EXTRA_WORDS = [
    ("ur", "urd", "ایک"),                    # ایک
    ("ur", "urd", "بْایک"),        # ب + SUKUN + ایک
    ("ur", "urd", "بَایک"),        # ب + FATHA + ایک
    ("ur", "urd", "ءایک"),              # ء + ایک
    ("ur", "urd", "ٔایک"),              # HAMZA ABOVE + ایک
    ("ur", "urd", "١ایک"),              # ١ + ایک
    ("ur", "urd", "ایکایک"),  # ایکایک (mid-word "ای" must NOT fire)
]

out = []
seen = set()


def emit(lang, lcode, text):
    for w in re.findall(r"[^\s]+", text):
        clean = re.sub(r"[،؛؟.]+$", "", w)
        if not clean or (lang, clean) in seen:
            continue
        seen.add((lang, clean))
        out.append({"lang": lang, "lcode": lcode, "word": clean,
                    "uroman": u.romanize_string(clean, lcode=lcode)})


for fx in fixtures:
    if fx["script"] != "Perso-Arabic":
        continue
    emit(fx["lang"], fx["lcode"], fx["input"])

for lang, lcode, text in EXTRA_SAMPLES:
    emit(lang, lcode, text)
for lang, lcode, word in EXTRA_WORDS:
    emit(lang, lcode, word)

with open("test/fixtures/romanize/golden-words-arabic.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", len(out), "fixtures")
