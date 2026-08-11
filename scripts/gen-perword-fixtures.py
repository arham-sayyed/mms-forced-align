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
#
# Every other language's block was added in Task 14, which is this plan's
# designated hardening pass. Those sentences are ordinary prose chosen for
# character coverage rather than topic; in particular each Brahmic language
# that has them contributes words with:
#   * VOCALIC vowel signs (ृ ৃ ૃ ୃ ృ ೃ ൃ), e.g. कृपया / সংস্কৃতি / કૃપા /
#     କୃଷକ / కృష్ణా / ಕೃಷಿ / കൃഷി and the ॠ/ऋ independent letters. Before
#     Task 14 these produced "kr" where uroman gives "kra"; they were the
#     single largest family of known mismatches (~160-200 per script).
#   * a word-final NYA/YYA (ঞ ঞ য় ୟ य़), whose table entry carries a baked-in
#     default vowel, e.g. Bengali সময় / বিষয় / হয়.
#   * a word-final consonant cluster (C + virama + C), e.g. Bengali ছাত্র /
#     যত্ন / চিহ্ন / রাষ্ট্র and Assamese যত্ন -- the schwa-deleting-language
#     case of Task 4's `precededByVirama` rule, which until Task 14 had never
#     been exercised outside Devanagari.
#   * nukta forms, candrabindu, anusvara, visarga and (Gurmukhi) ADDAK.
#
# The four smaller Devanagari languages (mai/doi/kok/brx) get shorter blocks
# than hi/mr/ne/sa on purpose: Devanagari's romanization is identical for all
# of them except for one lcode test (san keeps word-final schwa, everything
# else deletes it), so extra sentences there add lcode coverage rather than
# character coverage, and it is better to write fewer sentences we are
# confident are idiomatic than many we are not.
EXTRA_SAMPLES = [
    # --- Tamil (Task 9) ---------------------------------------------------
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

    # --- Hindi (Task 14) --------------------------------------------------
    ("hi", "hin", "Devanagari", "कृपया अपना नाम और पता यहाँ लिखिए।"),
    ("hi", "hin", "Devanagari", "भारत की संस्कृति बहुत प्राचीन और विविध है।"),
    ("hi", "hin", "Devanagari", "वृक्षों की छाया में बैठकर उसने पुस्तक पढ़ी।"),
    ("hi", "hin", "Devanagari", "हृदय की धड़कन तेज़ हो गई थी।"),
    ("hi", "hin", "Devanagari", "पृथ्वी सूर्य के चारों ओर घूमती है।"),
    ("hi", "hin", "Devanagari", "विद्यार्थी परीक्षा की तैयारी में व्यस्त हैं।"),
    ("hi", "hin", "Devanagari", "गाँव के लोग खेतों में काम कर रहे थे।"),
    ("hi", "hin", "Devanagari", "दृष्टि कमज़ोर होने के कारण उसने चश्मा पहना।"),
    ("hi", "hin", "Devanagari", "मुझे मिठाई खाना बहुत पसंद है।"),
    ("hi", "hin", "Devanagari", "सरकार ने नई योजना की घोषणा की।"),
    ("hi", "hin", "Devanagari", "बच्चे बगीचे में खेल रहे हैं।"),
    ("hi", "hin", "Devanagari", "रेलगाड़ी स्टेशन पर समय से पहुँची।"),
    ("hi", "hin", "Devanagari", "उन्होंने अपनी मातृभाषा में कविता लिखी।"),
    ("hi", "hin", "Devanagari", "ठंड के मौसम में सुबह जल्दी उठना मुश्किल है।"),
    ("hi", "hin", "Devanagari", "यह ज़रूरी है कि हम हमेशा सच बोलें।"),

    # --- Marathi ----------------------------------------------------------
    ("mr", "mar", "Devanagari", "महाराष्ट्रातील लोक मराठी भाषा बोलतात."),
    ("mr", "mar", "Devanagari", "कृपया दार बंद करा."),
    ("mr", "mar", "Devanagari", "मुले शाळेत जाऊन अभ्यास करतात."),
    ("mr", "mar", "Devanagari", "पावसाळ्यात नदीला पूर येतो."),
    ("mr", "mar", "Devanagari", "तिने स्वयंपाकघरात भाजी शिजवली."),
    ("mr", "mar", "Devanagari", "सूर्य पूर्वेला उगवतो आणि पश्चिमेला मावळतो."),
    ("mr", "mar", "Devanagari", "आमच्या गावात दरवर्षी मोठी जत्रा भरते."),
    ("mr", "mar", "Devanagari", "त्याने पुस्तक वाचून संपवले."),
    ("mr", "mar", "Devanagari", "संस्कृती आणि परंपरा जपणे महत्त्वाचे आहे."),
    ("mr", "mar", "Devanagari", "वृक्षतोड थांबवली पाहिजे."),
    ("mr", "mar", "Devanagari", "शेतकरी शेतात काम करत आहेत."),
    ("mr", "mar", "Devanagari", "मला गोड पदार्थ फार आवडतात."),
    ("mr", "mar", "Devanagari", "रेल्वे स्थानकावर खूप गर्दी होती."),
    ("mr", "mar", "Devanagari", "दृष्टी अधू असल्यामुळे त्याने चष्मा घातला."),
    ("mr", "mar", "Devanagari", "हृदयाची धडधड वाढली होती."),

    # --- Nepali -----------------------------------------------------------
    ("ne", "nep", "Devanagari", "नेपालको राजधानी काठमाडौं हो।"),
    ("ne", "nep", "Devanagari", "कृपया मलाई सहयोग गर्नुहोस्।"),
    ("ne", "nep", "Devanagari", "हिमालका हिउँ चुचुराहरू सुन्दर देखिन्छन्।"),
    ("ne", "nep", "Devanagari", "विद्यार्थीहरू विद्यालयमा पढ्दै छन्।"),
    ("ne", "nep", "Devanagari", "आमाले भात पकाउनुभयो।"),
    ("ne", "nep", "Devanagari", "गाउँका मानिसहरू खेतमा काम गर्छन्।"),
    ("ne", "nep", "Devanagari", "वर्षामा नदीको पानी बढ्छ।"),
    ("ne", "nep", "Devanagari", "संस्कृति र परम्परा जोगाउनु पर्छ।"),
    ("ne", "nep", "Devanagari", "उनले मातृभाषामा कविता लेखे।"),
    ("ne", "nep", "Devanagari", "सूर्य पूर्वबाट उदाउँछ।"),
    ("ne", "nep", "Devanagari", "बजारमा धेरै भीड थियो।"),
    ("ne", "nep", "Devanagari", "मलाई मिठाई खान मन पर्छ।"),
    ("ne", "nep", "Devanagari", "दृष्टि कमजोर भएकाले उनले चश्मा लगाए।"),
    ("ne", "nep", "Devanagari", "सरकारले नयाँ नीति घोषणा गरे।"),
    ("ne", "nep", "Devanagari", "जाडो मौसममा बिहान उठ्न गाह्रो हुन्छ।"),

    # --- Sanskrit ---------------------------------------------------------
    # san is the one lcode in this whole engine that does NOT delete a
    # word-final schwa, so it is the control case for every "does this
    # consonant keep its default vowel" rule -- worth a full block.
    ("sa", "san", "Devanagari", "सत्यमेव जयते नानृतम्।"),
    ("sa", "san", "Devanagari", "विद्या ददाति विनयम्।"),
    ("sa", "san", "Devanagari", "वृक्षाः जलं विना न जीवन्ति।"),
    ("sa", "san", "Devanagari", "गुरुः शिष्येभ्यः ज्ञानं ददाति।"),
    ("sa", "san", "Devanagari", "सूर्यः पूर्वस्यां दिशि उदेति।"),
    ("sa", "san", "Devanagari", "कृष्णः अर्जुनाय गीतां अवदत्।"),
    ("sa", "san", "Devanagari", "पृथिव्यां बहवः जनाः वसन्ति।"),
    ("sa", "san", "Devanagari", "मातृभूमिः स्वर्गादपि गरीयसी।"),
    ("sa", "san", "Devanagari", "अहं संस्कृतं पठामि।"),
    ("sa", "san", "Devanagari", "नद्याः जलं शीतलम् अस्ति।"),
    ("sa", "san", "Devanagari", "बालकाः उद्याने क्रीडन्ति।"),
    ("sa", "san", "Devanagari", "हृदये शान्तिः भवतु।"),
    ("sa", "san", "Devanagari", "ऋषयः तपः कुर्वन्ति।"),
    ("sa", "san", "Devanagari", "धर्मो रक्षति रक्षितः।"),
    ("sa", "san", "Devanagari", "जीवने सत्यस्य महत्त्वम् अस्ति।"),
    ("sa", "san", "Devanagari", "ॐ नमः शिवाय।"),
    ("sa", "san", "Devanagari", "ॐ शान्तिः शान्तिः शान्तिः।"),
    # Vedic Sanskrit, Rigveda 1.1.1 -- real accented text, and the only
    # realistic source of the Devanagari stress signs U+0951 UDATTA and
    # U+0952 ANUDATTA. Those romanize to the empty string, which (Task 14)
    # makes the *following* consonant word-initial for uroman's
    # is_at_start_of_word and so keeps its default vowel even in a
    # schwa-deleting language. No non-Vedic sentence can reach that rule.
    ("sa", "san", "Devanagari", "अ॒ग्निमी॑ळे पु॒रोहि॑तं य॒ज्ञस्य॑ दे॒वमृ॒त्विज॑म्।"),
    ("sa", "san", "Devanagari", "होता॑रं रत्न॒धात॑मम्।"),

    # --- Maithili ---------------------------------------------------------
    ("mai", "mai", "Devanagari", "मिथिलाक संस्कृति बहुत पुरान अछि।"),
    ("mai", "mai", "Devanagari", "हम गाम जा रहल छी।"),
    ("mai", "mai", "Devanagari", "कृपया अहाँ एतय बैसू।"),
    ("mai", "mai", "Devanagari", "बच्चा सभ विद्यालय जाइत अछि।"),
    ("mai", "mai", "Devanagari", "माय भोजन बनौलनि।"),
    ("mai", "mai", "Devanagari", "नदीक पानि बहुत साफ अछि।"),
    ("mai", "mai", "Devanagari", "गाछ सभ हरियर अछि।"),
    ("mai", "mai", "Devanagari", "हुनका मिठाइ बहुत नीक लगैत छनि।"),
    ("mai", "mai", "Devanagari", "खेत मे किसान काज करैत छथि।"),
    ("mai", "mai", "Devanagari", "आइ भोरे बहुत जाड़ छल।"),
    ("mai", "mai", "Devanagari", "ओ अपन मातृभाषा मे कविता लिखलनि।"),
    ("mai", "mai", "Devanagari", "सूर्य पूब दिस उगैत अछि।"),

    # --- Dogri ------------------------------------------------------------
    ("doi", "doi", "Devanagari", "डोगरी भाशा जम्मू च बोली जंदी ऐ।"),
    ("doi", "doi", "Devanagari", "अज्ज मौसम बड़ा वधिया ऐ।"),
    ("doi", "doi", "Devanagari", "मिगी मिठाई खाना बड़ा पसंद ऐ।"),
    ("doi", "doi", "Devanagari", "बच्चे स्कूल गे न।"),
    ("doi", "doi", "Devanagari", "माता जी रोटी बनांदी ऐ।"),
    ("doi", "doi", "Devanagari", "गांह दे लोक खेतें च कम्म करदे न।"),
    ("doi", "doi", "Devanagari", "नदी दा पानी ठंडा ऐ।"),
    ("doi", "doi", "Devanagari", "साढ़ी संस्कृति बड़ी पुराणी ऐ।"),
    ("doi", "doi", "Devanagari", "ओह किताब पढ़दा ऐ।"),
    ("doi", "doi", "Devanagari", "सूरज पूरब चा निकलदा ऐ।"),
    ("doi", "doi", "Devanagari", "रेल गड्डी स्टेशन पर पुज्जी।"),
    ("doi", "doi", "Devanagari", "कृपया दरवाजा बंद करो।"),

    # --- Konkani ----------------------------------------------------------
    ("kok", "kok", "Devanagari", "गोंयची संस्कृती खूब सुंदर आसा."),
    ("kok", "kok", "Devanagari", "हांव आयज बाजारांत गेलों."),
    ("kok", "kok", "Devanagari", "भुरगीं शाळेंत वतात."),
    ("kok", "kok", "Devanagari", "आवय जेवण करता."),
    ("kok", "kok", "Devanagari", "दर्याच्या देगेर लोक भोंवतात."),
    ("kok", "kok", "Devanagari", "कृपया दार बंद कर."),
    ("kok", "kok", "Devanagari", "शेतकार शेतांत काम करतात."),
    ("kok", "kok", "Devanagari", "सूर्य उदेंतेक उदेता."),
    ("kok", "kok", "Devanagari", "म्हाका गोड खावंक आवडता."),
    ("kok", "kok", "Devanagari", "पावस पडटा तेन्ना नंय भरता."),
    ("kok", "kok", "Devanagari", "ताणें पुस्तक वाचलें."),
    ("kok", "kok", "Devanagari", "वृक्ष तोडप बरें न्हय."),

    # --- Bodo -------------------------------------------------------------
    # बर' / मोन' etc. carry the ASCII apostrophe Bodo uses for /ɯ/. It is
    # preserved by cleanNativeWord and romanizes to "'" -- see brahmic.ts's
    # apostrophe branch, added in Task 14 after this fixture set first hit it.
    ("brx", "brx", "Devanagari", "बर' राव आसामनि मुलुगनि राव।"),
    ("brx", "brx", "Devanagari", "आं दिनै बाजारआव थांगोन।"),
    ("brx", "brx", "Devanagari", "फिसाफोर फरायसालियाव फरायो।"),
    ("brx", "brx", "Devanagari", "बिमा साननायाव आगान दानो।"),
    ("brx", "brx", "Devanagari", "आबादगिरिफोर हालामाव खामानि मावो।"),
    ("brx", "brx", "Devanagari", "आंहा मिठाइ जानो गोबां मोजां।"),
    ("brx", "brx", "Devanagari", "सान सानजायाव ओंखारो।"),
    ("brx", "brx", "Devanagari", "दै गोजौ जायो।"),
    ("brx", "brx", "Devanagari", "जौगानाय थाखाय सोलों गोनां।"),
    ("brx", "brx", "Devanagari", "बिनि बिजाब आं फरायदों।"),

    # --- Bengali ----------------------------------------------------------
    ("bn", "ben", "Bengali", "আজ সকালে আকাশ পরিষ্কার ছিল।"),
    ("bn", "ben", "Bengali", "ছাত্ররা ক্লাসে মনোযোগ দিয়ে পড়ছে।"),
    ("bn", "ben", "Bengali", "তিনি একজন বিখ্যাত চিত্রশিল্পী।"),
    ("bn", "ben", "Bengali", "কৃষকরা মাঠে ধান কাটছে।"),
    ("bn", "ben", "Bengali", "আমার প্রিয় বিষয় হলো ইতিহাস।"),
    ("bn", "ben", "Bengali", "সময় খুব দ্রুত চলে যায়।"),
    ("bn", "ben", "Bengali", "এই বইটি খুব সুন্দর এবং শিক্ষণীয়।"),
    ("bn", "ben", "Bengali", "দৃষ্টিশক্তি দুর্বল হওয়ায় সে চশমা পরে।"),
    ("bn", "ben", "Bengali", "বাংলাদেশের রাজধানী ঢাকা।"),
    ("bn", "ben", "Bengali", "সংস্কৃতি ও ঐতিহ্য রক্ষা করা দরকার।"),
    ("bn", "ben", "Bengali", "ছেলেটি মাঠে ফুটবল খেলছে।"),
    ("bn", "ben", "Bengali", "যন্ত্রটি নষ্ট হয়ে গেছে।"),
    ("bn", "ben", "Bengali", "রাষ্ট্রের উন্নয়ন সবার দায়িত্ব।"),
    ("bn", "ben", "Bengali", "মা রান্নাঘরে খাবার তৈরি করছেন।"),
    ("bn", "ben", "Bengali", "বৃষ্টি হলে গাছপালা সবুজ হয়ে ওঠে।"),
    ("bn", "ben", "Bengali", "সে খুব যত্ন করে কাজটি করেছে।"),
    ("bn", "ben", "Bengali", "তার চিহ্ন এখনো রয়ে গেছে।"),
    ("bn", "ben", "Bengali", "একজন ভালো ছাত্র সবসময় প্রশ্ন করে।"),

    # --- Assamese ---------------------------------------------------------
    ("as", "asm", "Bengali", "অসমীয়া ভাষা অসমৰ ৰাজ্যিক ভাষা।"),
    ("as", "asm", "Bengali", "আজি ৰাতিপুৱা বৰষুণ দিছিল।"),
    ("as", "asm", "Bengali", "ছাত্ৰসকলে মন দি পঢ়িছে।"),
    ("as", "asm", "Bengali", "মই ভাত খাইছোঁ।"),
    ("as", "asm", "Bengali", "কৃষকসকলে পথাৰত কাম কৰিছে।"),
    ("as", "asm", "Bengali", "তেওঁ এজন বিখ্যাত লেখক।"),
    ("as", "asm", "Bengali", "সময় বহুত সোনকালে পাৰ হৈ যায়।"),
    ("as", "asm", "Bengali", "এই কিতাপখন বৰ ধুনীয়া।"),
    ("as", "asm", "Bengali", "অসমৰ সংস্কৃতি বহুত চহকী।"),
    ("as", "asm", "Bengali", "যন্ত্ৰটো নষ্ট হৈ গৈছে।"),
    ("as", "asm", "Bengali", "মাকে ৰন্ধাঘৰত ৰান্ধি আছে।"),
    ("as", "asm", "Bengali", "বৰষুণ দিলে গছবোৰ সেউজীয়া হয়।"),
    ("as", "asm", "Bengali", "তেওঁ যত্ন লৈ কামটো কৰিছে।"),

    # --- Punjabi (Gurmukhi) -----------------------------------------------
    ("pa", "pan", "Gurmukhi", "ਪੰਜਾਬੀ ਸਾਡੀ ਮਾਂ ਬੋਲੀ ਹੈ।"),
    ("pa", "pan", "Gurmukhi", "ਅੱਜ ਮੌਸਮ ਬਹੁਤ ਸੁਹਾਵਣਾ ਹੈ।"),
    ("pa", "pan", "Gurmukhi", "ਕਿਸਾਨ ਖੇਤਾਂ ਵਿੱਚ ਕੰਮ ਕਰ ਰਹੇ ਹਨ।"),
    ("pa", "pan", "Gurmukhi", "ਬੱਚੇ ਸਕੂਲ ਵਿੱਚ ਪੜ੍ਹ ਰਹੇ ਹਨ।"),
    ("pa", "pan", "Gurmukhi", "ਮੈਨੂੰ ਮਿੱਠਾ ਖਾਣਾ ਬਹੁਤ ਪਸੰਦ ਹੈ।"),
    ("pa", "pan", "Gurmukhi", "ਗੁਰਦੁਆਰੇ ਵਿੱਚ ਸੰਗਤ ਇਕੱਠੀ ਹੋਈ।"),
    ("pa", "pan", "Gurmukhi", "ਦਰਿਆ ਦਾ ਪਾਣੀ ਠੰਢਾ ਸੀ।"),
    ("pa", "pan", "Gurmukhi", "ਉਸ ਨੇ ਕਿਤਾਬ ਪੜ੍ਹ ਕੇ ਖ਼ਤਮ ਕੀਤੀ।"),
    ("pa", "pan", "Gurmukhi", "ਸਾਡਾ ਸੱਭਿਆਚਾਰ ਬਹੁਤ ਅਮੀਰ ਹੈ।"),
    ("pa", "pan", "Gurmukhi", "ਸੂਰਜ ਪੂਰਬ ਵੱਲੋਂ ਚੜ੍ਹਦਾ ਹੈ।"),
    ("pa", "pan", "Gurmukhi", "ਰੇਲ ਗੱਡੀ ਸਟੇਸ਼ਨ ਉੱਤੇ ਪਹੁੰਚੀ।"),
    ("pa", "pan", "Gurmukhi", "ਮਾਤਾ ਜੀ ਰਸੋਈ ਵਿੱਚ ਰੋਟੀ ਬਣਾ ਰਹੇ ਹਨ।"),
    ("pa", "pan", "Gurmukhi", "ਪਿੰਡ ਦੇ ਲੋਕ ਮੇਲੇ ਵਿੱਚ ਗਏ।"),
    ("pa", "pan", "Gurmukhi", "ਸਰਕਾਰ ਨੇ ਨਵੀਂ ਯੋਜਨਾ ਦਾ ਐਲਾਨ ਕੀਤਾ।"),
    ("pa", "pan", "Gurmukhi", "ਵਿਦਿਆਰਥੀ ਇਮਤਿਹਾਨ ਦੀ ਤਿਆਰੀ ਕਰ ਰਹੇ ਹਨ।"),

    # --- Gujarati ---------------------------------------------------------
    ("gu", "guj", "Gujarati", "ગુજરાતી ભાષા ખૂબ મીઠી છે."),
    ("gu", "guj", "Gujarati", "કૃપા કરીને દરવાજો બંધ કરો."),
    ("gu", "guj", "Gujarati", "બાળકો બગીચામાં રમી રહ્યાં છે."),
    ("gu", "guj", "Gujarati", "ખેડૂતો ખેતરમાં કામ કરે છે."),
    ("gu", "guj", "Gujarati", "મને મીઠાઈ ખાવાનું બહુ ગમે છે."),
    ("gu", "guj", "Gujarati", "સૂર્ય પૂર્વ દિશામાં ઊગે છે."),
    ("gu", "guj", "Gujarati", "વૃક્ષોની છાયામાં બેસીને તેણે પુસ્તક વાંચ્યું."),
    ("gu", "guj", "Gujarati", "અમારા ગામમાં દર વર્ષે મોટો મેળો ભરાય છે."),
    ("gu", "guj", "Gujarati", "દૃષ્ટિ નબળી હોવાથી તેણે ચશ્માં પહેર્યાં."),
    ("gu", "guj", "Gujarati", "સંસ્કૃતિ અને પરંપરા જાળવવી જરૂરી છે."),
    ("gu", "guj", "Gujarati", "ટ્રેન સ્ટેશન પર સમયસર પહોંચી."),
    ("gu", "guj", "Gujarati", "હૃદયના ધબકારા વધી ગયા હતા."),
    ("gu", "guj", "Gujarati", "વરસાદ પડે ત્યારે નદી ભરાઈ જાય છે."),
    ("gu", "guj", "Gujarati", "વિદ્યાર્થીઓ પરીક્ષાની તૈયારી કરે છે."),
    ("gu", "guj", "Gujarati", "માતાએ રસોડામાં ભોજન બનાવ્યું."),

    # --- Oriya ------------------------------------------------------------
    ("od", "ori", "Oriya", "ଓଡ଼ିଆ ଭାଷା ବହୁତ ମଧୁର।"),
    ("od", "ori", "Oriya", "କୃଷକମାନେ ଜମିରେ କାମ କରୁଛନ୍ତି।"),
    ("od", "ori", "Oriya", "ପିଲାମାନେ ବିଦ୍ୟାଳୟରେ ପଢ଼ୁଛନ୍ତି।"),
    ("od", "ori", "Oriya", "ଆଜି ସକାଳେ ଆକାଶ ପରିଷ୍କାର ଥିଲା।"),
    ("od", "ori", "Oriya", "ମୋତେ ମିଠା ଖାଇବାକୁ ବହୁତ ଭଲ ଲାଗେ।"),
    ("od", "ori", "Oriya", "ସୂର୍ଯ୍ୟ ପୂର୍ବ ଦିଗରେ ଉଦୟ ହୁଏ।"),
    ("od", "ori", "Oriya", "ଆମ ଗାଁରେ ପ୍ରତିବର୍ଷ ବଡ଼ ମେଳା ହୁଏ।"),
    ("od", "ori", "Oriya", "ଦୃଷ୍ଟି ଦୁର୍ବଳ ହେବାରୁ ସେ ଚଷମା ପିନ୍ଧିଲେ।"),
    ("od", "ori", "Oriya", "ସଂସ୍କୃତି ଓ ପରମ୍ପରା ରକ୍ଷା କରିବା ଦରକାର।"),
    ("od", "ori", "Oriya", "ରେଳଗାଡ଼ି ଷ୍ଟେସନରେ ପହଞ୍ଚିଲା।"),
    ("od", "ori", "Oriya", "ମା ରୋଷେଇ ଘରେ ଖାଦ୍ୟ ପ୍ରସ୍ତୁତ କରୁଛନ୍ତି।"),
    ("od", "ori", "Oriya", "ବର୍ଷା ହେଲେ ନଦୀରେ ପାଣି ବଢ଼େ।"),
    ("od", "ori", "Oriya", "ଛାତ୍ରମାନେ ପରୀକ୍ଷା ପାଇଁ ପ୍ରସ୍ତୁତ ହେଉଛନ୍ତି।"),
    ("od", "ori", "Oriya", "ହୃଦୟର ସ୍ପନ୍ଦନ ବଢ଼ିଗଲା।"),
    ("od", "ori", "Oriya", "ସରକାର ନୂଆ ଯୋଜନା ଘୋଷଣା କଲେ।"),

    # --- Telugu -----------------------------------------------------------
    ("te", "tel", "Telugu", "తెలుగు భాష చాలా మధురంగా ఉంటుంది."),
    ("te", "tel", "Telugu", "కృష్ణా నది ఆంధ్రప్రదేశ్ గుండా ప్రవహిస్తుంది."),
    ("te", "tel", "Telugu", "రైతులు పొలంలో పని చేస్తున్నారు."),
    ("te", "tel", "Telugu", "పిల్లలు పాఠశాలలో చదువుతున్నారు."),
    ("te", "tel", "Telugu", "నాకు తీపి పదార్థాలు చాలా ఇష్టం."),
    ("te", "tel", "Telugu", "సూర్యుడు తూర్పున ఉదయిస్తాడు."),
    ("te", "tel", "Telugu", "వృక్షాల నీడలో కూర్చుని అతను పుస్తకం చదివాడు."),
    ("te", "tel", "Telugu", "మా ఊరిలో ప్రతి సంవత్సరం పెద్ద జాతర జరుగుతుంది."),
    ("te", "tel", "Telugu", "దృష్టి మందగించడంతో ఆయన కళ్ళజోడు పెట్టుకున్నాడు."),
    ("te", "tel", "Telugu", "సంస్కృతి మరియు సంప్రదాయాలను కాపాడుకోవాలి."),
    ("te", "tel", "Telugu", "రైలు సమయానికి స్టేషన్ చేరుకుంది."),
    ("te", "tel", "Telugu", "అమ్మ వంటగదిలో వంట చేస్తోంది."),
    ("te", "tel", "Telugu", "వర్షం పడితే చెరువులు నిండుతాయి."),
    ("te", "tel", "Telugu", "హృదయ స్పందన వేగంగా మారింది."),
    ("te", "tel", "Telugu", "విద్యార్థులు పరీక్షలకు సిద్ధమవుతున్నారు."),

    # --- Kannada ----------------------------------------------------------
    ("kn", "kan", "Kannada", "ಕನ್ನಡ ಭಾಷೆ ಬಹಳ ಸುಂದರವಾಗಿದೆ."),
    ("kn", "kan", "Kannada", "ಕೃಷಿ ನಮ್ಮ ದೇಶದ ಬೆನ್ನೆಲುಬು."),
    ("kn", "kan", "Kannada", "ಮಕ್ಕಳು ಶಾಲೆಯಲ್ಲಿ ಓದುತ್ತಿದ್ದಾರೆ."),
    ("kn", "kan", "Kannada", "ರೈತರು ಹೊಲದಲ್ಲಿ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದಾರೆ."),
    ("kn", "kan", "Kannada", "ನನಗೆ ಸಿಹಿ ತಿನಿಸು ತುಂಬಾ ಇಷ್ಟ."),
    ("kn", "kan", "Kannada", "ಸೂರ್ಯ ಪೂರ್ವದಲ್ಲಿ ಉದಯಿಸುತ್ತಾನೆ."),
    ("kn", "kan", "Kannada", "ವೃಕ್ಷಗಳ ನೆರಳಿನಲ್ಲಿ ಕುಳಿತು ಅವನು ಪುಸ್ತಕ ಓದಿದನು."),
    ("kn", "kan", "Kannada", "ನಮ್ಮ ಊರಿನಲ್ಲಿ ಪ್ರತಿ ವರ್ಷ ದೊಡ್ಡ ಜಾತ್ರೆ ನಡೆಯುತ್ತದೆ."),
    ("kn", "kan", "Kannada", "ದೃಷ್ಟಿ ಮಂದವಾದ ಕಾರಣ ಅವರು ಕನ್ನಡಕ ಧರಿಸಿದರು."),
    ("kn", "kan", "Kannada", "ಸಂಸ್ಕೃತಿ ಮತ್ತು ಪರಂಪರೆಯನ್ನು ಉಳಿಸಬೇಕು."),
    ("kn", "kan", "Kannada", "ರೈಲು ನಿಲ್ದಾಣಕ್ಕೆ ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಬಂತು."),
    ("kn", "kan", "Kannada", "ಅಮ್ಮ ಅಡುಗೆಮನೆಯಲ್ಲಿ ಅಡುಗೆ ಮಾಡುತ್ತಿದ್ದಾರೆ."),
    ("kn", "kan", "Kannada", "ಮಳೆ ಬಂದರೆ ಕೆರೆಗಳು ತುಂಬುತ್ತವೆ."),
    ("kn", "kan", "Kannada", "ಹೃದಯದ ಬಡಿತ ಹೆಚ್ಚಾಯಿತು."),
    ("kn", "kan", "Kannada", "ವಿದ್ಯಾರ್ಥಿಗಳು ಪರೀಕ್ಷೆಗೆ ಸಿದ್ಧರಾಗುತ್ತಿದ್ದಾರೆ."),

    # --- Malayalam --------------------------------------------------------
    ("ml", "mal", "Malayalam", "മലയാളം കേരളത്തിന്റെ ഭാഷയാണ്."),
    ("ml", "mal", "Malayalam", "കൃഷി നമ്മുടെ നാടിന്റെ അടിസ്ഥാനമാണ്."),
    ("ml", "mal", "Malayalam", "കുട്ടികൾ സ്കൂളിൽ പഠിക്കുന്നു."),
    ("ml", "mal", "Malayalam", "കർഷകർ വയലിൽ ജോലി ചെയ്യുന്നു."),
    ("ml", "mal", "Malayalam", "എനിക്ക് മധുരപലഹാരങ്ങൾ വളരെ ഇഷ്ടമാണ്."),
    ("ml", "mal", "Malayalam", "സൂര്യൻ കിഴക്ക് ഉദിക്കുന്നു."),
    ("ml", "mal", "Malayalam", "വൃക്ഷങ്ങളുടെ തണലിൽ ഇരുന്ന് അവൻ പുസ്തകം വായിച്ചു."),
    ("ml", "mal", "Malayalam", "ഞങ്ങളുടെ ഗ്രാമത്തിൽ എല്ലാ വർഷവും വലിയ ഉത്സവം നടക്കും."),
    ("ml", "mal", "Malayalam", "കാഴ്ചശക്തി കുറഞ്ഞതിനാൽ അദ്ദേഹം കണ്ണട ധരിച്ചു."),
    ("ml", "mal", "Malayalam", "സംസ്കാരവും പാരമ്പര്യവും സംരക്ഷിക്കണം."),
    ("ml", "mal", "Malayalam", "തീവണ്ടി സമയത്ത് സ്റ്റേഷനിൽ എത്തി."),
    ("ml", "mal", "Malayalam", "അമ്മ അടുക്കളയിൽ ഭക്ഷണം ഉണ്ടാക്കുന്നു."),
    ("ml", "mal", "Malayalam", "മഴ പെയ്താൽ പുഴകൾ നിറയും."),
    ("ml", "mal", "Malayalam", "ഹൃദയമിടിപ്പ് വർധിച്ചു."),
    ("ml", "mal", "Malayalam", "വിദ്യാർത്ഥികൾ പരീക്ഷയ്ക്ക് തയ്യാറെടുക്കുന്നു."),
]

# Individual probe words for shapes that no ordinary sentence in the blocks
# above happens to contain. These are still real words, not synthetic
# character soup -- they are listed separately only because forcing them into
# a sentence would have meant inventing unnatural prose.
EXTRA_WORDS = [
    # U+0950 DEVANAGARI OM and U+0BD0 TAMIL OM. Both throw a RomanizeError
    # until scripts/extract-uroman-data.py stops scoping the Brahmic character
    # set to UnicodeDataProps.txt's incomplete per-script `::char` list (which
    # omits them, so UnicodeDataOverwrite.txt's `::u 0950 ::r om` entry was
    # being filtered out). Real uroman: ॐ -> "om" for hin/san, ௐ -> "om" for
    # tam. This is ordinary devotional/liturgical text, not an exotic shape.
    ("hi", "hin", "Devanagari", "ॐ"),
    ("sa", "san", "Devanagari", "ॐ"),
    ("hi", "hin", "Devanagari", "ॐकार"),
    ("sa", "san", "Devanagari", "ॐकारः"),
    ("ta", "tam", "Tamil", "ௐ"),
    # Gujarati candrabindu U+0A81. Modern Gujarati almost always writes
    # nasalization with anusvara (ં), so no ordinary prose sentence above
    # contains ઁ -- but it is a live character in Gujarati poetry and in
    # older/variant orthography, where માઁ ("mother") and હુઁ ("I") are the
    # everyday spellings. This is the ONLY reachable use of brahmic.ts's
    # candrabindu fallback (Devanagari/Bengali/Oriya candrabindu all have
    # real table entries; Tamil/Telugu/Kannada/Malayalam have no such
    # character). Real uroman: માઁ -> "maa", હુઁ -> "hu" -- i.e. the
    # candrabindu contributes nothing at all, which is what Task 14 fixed.
    ("gu", "guj", "Gujarati", "માઁ"),
    ("gu", "guj", "Gujarati", "હુઁ"),
    # Gurmukhi ADAK BINDI U+0A01, the same fallback for Punjabi. Also rare in
    # modern print. Real uroman: ਕਁ -> "ka".
    ("pa", "pan", "Gurmukhi", "ਮਾਁ"),
    # Bengali/Assamese word-final conjunct clusters (C + virama + C). These
    # are the schwa-deleting-script half of Task 4's precededByVirama rule:
    # ben/asm delete a word-final schwa, but NOT when the final consonant
    # follows a virama. Real uroman: ছাত্র -> "chhaatra" (not "chhaatr"),
    # যত্ন -> "yatna", চিহ্ন -> "chihna", রাষ্ট্র -> "raassttra".
    ("bn", "ben", "Bengali", "ছাত্র"),
    ("bn", "ben", "Bengali", "যত্ন"),
    ("bn", "ben", "Bengali", "চিহ্ন"),
    ("bn", "ben", "Bengali", "রাষ্ট্র"),
    ("bn", "ben", "Bengali", "মন্ত্র"),
    ("as", "asm", "Bengali", "যত্ন"),
    ("as", "asm", "Bengali", "ছাত্ৰ"),
    # Bengali word-final anusvara (this plan's "Known gaps" #4). এবং -> the
    # anusvara is U+0982, whose own table entry is "+ng"; there is no
    # word-position rule involved. Sampled here in every position -- final,
    # medial, and before a consonant -- to confirm that.
    ("bn", "ben", "Bengali", "এবং"),
    ("bn", "ben", "Bengali", "বংশ"),
    ("bn", "ben", "Bengali", "রং"),
    ("bn", "ben", "Bengali", "সংগীত"),
    ("bn", "ben", "Bengali", "শুভেচ্ছা"),
    # Bengali/Devanagari YYA and the nukta-composed য়/य़ spellings of it, in
    # word-final position after a vowel sign. YYA's table entry carries a
    # baked-in default vowel ("yya"), which word-final schwa deletion must
    # NOT strip -- see deletesFinalSchwa's Task 14 note.
    ("bn", "ben", "Bengali", "সময়"),
    ("bn", "ben", "Bengali", "বিষয়"),
    ("bn", "ben", "Bengali", "হয়"),
    ("bn", "ben", "Bengali", "নয়"),
    ("hi", "hin", "Devanagari", "समय़"),
    # Devanagari independent VOCALIC letters (ऋ ॠ ऌ ॡ), word-initial,
    # word-internal and word-final -- the letter counterparts of the vocalic
    # vowel signs. Real uroman: ऋषि -> "rssi", मातृ -> "maatr" (hin),
    # "maatra" (san).
    ("hi", "hin", "Devanagari", "ऋषि"),
    ("hi", "hin", "Devanagari", "ऋतु"),
    ("hi", "hin", "Devanagari", "मातृ"),
    ("sa", "san", "Devanagari", "मातृ"),
    ("sa", "san", "Devanagari", "ऋषिः"),
    ("sa", "san", "Devanagari", "पितॄणाम्"),
    ("sa", "san", "Devanagari", "क्ऌप्त"),
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

for lang, lcode, script, word in EXTRA_WORDS:
    emit(lang, lcode, script, word, dedupe=True)

with open("test/fixtures/romanize/golden-words.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", len(out), "per-word fixtures")
