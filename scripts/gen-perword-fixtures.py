# -*- coding: utf-8 -*-
import json, re, os
import uroman as ur

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.chdir("..")

u = ur.Uroman()

with open("test/fixtures/romanize/golden-sentences.json", encoding="utf-8") as f:
    fixtures = json.load(f)

BRAHMIC = {"Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam"}

# Extra source sentences that exist only to broaden per-word fixture coverage.
# golden-sentences.json holds exactly one sentence per language, and they are
# all translations of the same "today I had a great experience" sentence --
# which under-exercises most of each script's character inventory. These are
# real, ordinary sentences with deliberately different vocabulary; they are
# kept here (rather than in golden-sentences.json) because that file's entries
# are whole-sentence golden fixtures with hand-checked `uroman_output`, while
# these only ever feed the per-word generator below.
#
# The Tamil block was added in Task 9. Tamil is the highest-risk script in
# this plan, and its original 9 fixture words all came from that one shared
# sentence. These 20 sentences were chosen to exercise the parts of Tamil the
# original sentence never touched: every geminate cluster type (க்க ச்ச ட்ட
# த்த ப்ப ற்ற ன்ன ள்ள ல்ல ண்ண), the nasal+stop clusters (ங்க ஞ்ச ண்ட ந்த ம்ப
# ன்ற), the three-way ர/ற and ந/ண/ன and ல/ள/ழ contrasts in both onset and
# coda position, word-final consonants, the grantha letters ஜ ஸ ஷ ஹ ஶ, and
# the aytam ஃ (both standalone and in the ஃப/ஃஜ digraphs).
EXTRA_SAMPLES = [
    ("ta", "tam", "Tamil", "தமிழ் மொழி உலகின் மிகப் பழமையான மொழிகளில் ஒன்று."),
    ("ta", "tam", "Tamil", "நான் நேற்று சென்னைக்குச் சென்றேன்."),
    ("ta", "tam", "Tamil", "அவர் ஒரு நல்ல ஆசிரியர் என்று அனைவரும் சொல்கிறார்கள்."),
    ("ta", "tam", "Tamil", "இந்த புத்தகத்தை நீங்கள் படித்தீர்களா?"),
    ("ta", "tam", "Tamil", "காலையில் பறவைகள் இனிமையாகப் பாடுகின்றன."),
    ("ta", "tam", "Tamil", "எங்கள் ஊரில் ஆண்டுதோறும் பெரிய திருவிழா நடக்கும்."),
    ("ta", "tam", "Tamil", "மாணவர்கள் பள்ளிக்கூடத்தில் கவனமாகப் படிக்கிறார்கள்."),
    ("ta", "tam", "Tamil", "அம்மா சமையலறையில் உணவு சமைத்துக் கொண்டிருக்கிறார்."),
    ("ta", "tam", "Tamil", "வானம் இருண்டு மழை பெய்யத் தொடங்கியது."),
    ("ta", "tam", "Tamil", "அவள் பாட்டு பாடுவதில் மிகவும் திறமையானவள்."),
    ("ta", "tam", "Tamil", "கடலின் அலைகள் கரையில் மோதி ஒலி எழுப்புகின்றன."),
    ("ta", "tam", "Tamil", "நண்பர்களுடன் பேசுவது எப்போதும் மகிழ்ச்சி அளிக்கும்."),
    ("ta", "tam", "Tamil", "அரசாங்கம் புதிய திட்டங்களை அறிவித்துள்ளது."),
    ("ta", "tam", "Tamil", "விவசாயிகள் வயலில் நெல் அறுவடை செய்கிறார்கள்."),
    ("ta", "tam", "Tamil", "குழந்தைகள் விளையாட்டு மைதானத்தில் ஓடி விளையாடுகிறார்கள்."),
    ("ta", "tam", "Tamil", "ஜன்னல் வழியாக சூரிய ஒளி அறைக்குள் வந்தது."),
    ("ta", "tam", "Tamil", "அஃது ஒரு பழைய தமிழ்ச் சொல் ஆகும்."),
    ("ta", "tam", "Tamil", "ஸ்ரீரங்கம் கோயில் காவிரி ஆற்றின் நடுவே அமைந்துள்ளது."),
    ("ta", "tam", "Tamil", "ஷாப்பிங் மாலில் மக்கள் கூட்டம் அதிகமாக இருந்தது."),
    ("ta", "tam", "Tamil", "ஹரி தினமும் காலையில் உடற்பயிற்சி செய்கிறான்."),
]

out = []
seen = set()


def emit(lang, lcode, script, sentence, dedupe):
    for w in re.findall(r"[^\s]+", sentence):
        clean = re.sub(r"[।.,!?॥]+$", "", w)  # strip trailing danda/punct like our pipeline will
        if not clean:
            continue
        if dedupe:
            if (lang, clean) in seen:
                continue
            seen.add((lang, clean))
        rom = u.romanize_string(clean, lcode=lcode)
        out.append({"lang": lang, "lcode": lcode, "script": script, "word": clean, "uroman": rom})


for fx in fixtures:
    if fx["script"] not in BRAHMIC:
        continue
    # Not deduped: preserves the exact pre-existing contents/order of the
    # golden-sentences.json-derived section of this file.
    emit(fx["lang"], fx["lcode"], fx["script"], fx["input"], dedupe=False)
    for w in re.findall(r"[^\s]+", fx["input"]):
        clean = re.sub(r"[।.,!?॥]+$", "", w)
        if clean:
            seen.add((fx["lang"], clean))

for lang, lcode, script, sentence in EXTRA_SAMPLES:
    if script not in BRAHMIC:
        continue
    emit(lang, lcode, script, sentence, dedupe=True)

with open("test/fixtures/romanize/golden-words.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", len(out), "per-word fixtures")
