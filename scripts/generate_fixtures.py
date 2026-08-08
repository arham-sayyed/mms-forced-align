"""
Generate golden test fixtures for align.golden.test.ts from a Python
reference alignment (torchaudio.pipelines.MMS_FA).

This is a one-time, local, developer-run tool (spec §6) — it is not part
of the published package and does not run in CI. Run it against your own
short audio clip + transcript to (re)generate test/fixtures/*.wav and
test/fixtures/*.json. The fixtures this repo ships are intentionally NOT
derived from any third-party recording; bring your own audio.

Usage:
    python scripts/generate_fixtures.py \\
        --audio path/to/full_clip.wav \\
        --transcript "Full transcript text spoken in that clip." \\
        --snippet snippet-1 "First few words of the transcript." \\
        --snippet snippet-2 "A different short phrase from later in the clip."

Each --snippet NAME TEXT must have TEXT appear verbatim (exact words, in
order) inside --transcript. The full clip is aligned once to locate each
snippet's rough time window, then a short slice around that window is
re-aligned standalone (matching exactly what the TypeScript package will
be given) to produce that snippet's golden word timings.

Requires: torch, torchaudio, soundfile.
"""
import argparse
import re
import os
import json
import torch
import torchaudio
import soundfile as sf

PAD_SECONDS = 0.15


def clean(word: str) -> str:
    return re.sub(r"[^\w']", "", word).lower()


def load_waveform(path, target_sr):
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    waveform = torch.from_numpy(audio).unsqueeze(0)
    if sr != target_sr:
        waveform = torchaudio.functional.resample(waveform, sr, target_sr)
    return waveform


def align(waveform, model, tokenizer, aligner, clean_words, sample_rate):
    with torch.inference_mode():
        emission, _ = model(waveform)
    tokens = tokenizer(clean_words)
    spans = aligner(emission[0], tokens)
    num_frames = emission.shape[1]
    ratio = waveform.shape[1] / num_frames / sample_rate
    return [
        {"word": w, "start": round(s[0].start * ratio, 4), "end": round(s[-1].end * ratio, 4)}
        for w, s in zip(clean_words, spans)
    ]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--audio", required=True, help="Path to the full source audio clip (any format soundfile can read).")
    transcript_group = parser.add_mutually_exclusive_group(required=True)
    transcript_group.add_argument("--transcript", help="Full transcript text spoken in --audio.")
    transcript_group.add_argument("--transcript-file", help="Path to a text file containing the full transcript.")
    parser.add_argument(
        "--snippet",
        nargs=2,
        action="append",
        metavar=("NAME", "TEXT"),
        required=True,
        help="A fixture to generate: a short, exact substring of --transcript. Repeatable.",
    )
    parser.add_argument("--out-dir", default="test/fixtures", help="Output directory for generated .wav/.json pairs.")
    parser.add_argument("--pad-seconds", type=float, default=PAD_SECONDS, help="Padding added around each snippet's rough time window before re-slicing.")
    return parser.parse_args()


def main():
    args = parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    raw_transcript = args.transcript
    if args.transcript_file:
        with open(args.transcript_file, "r", encoding="utf-8") as f:
            raw_transcript = f.read()

    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=False)
    tokenizer = bundle.get_tokenizer()
    aligner = bundle.get_aligner()
    sample_rate = bundle.sample_rate

    waveform = load_waveform(args.audio, sample_rate)
    display_words = raw_transcript.split()
    clean_words_full = [clean(w) for w in display_words]
    full_timings = align(waveform, model, tokenizer, aligner, clean_words_full, sample_rate)

    for name, snippet_text in args.snippet:
        snippet_words = snippet_text.split()
        n = len(snippet_words)
        start_idx = next(
            (i for i in range(len(display_words) - n + 1) if display_words[i : i + n] == snippet_words),
            None,
        )
        if start_idx is None:
            raise ValueError(f"{name}: snippet text not found verbatim in --transcript")
        end_idx = start_idx + n - 1

        t_start = max(0.0, full_timings[start_idx]["start"] - args.pad_seconds)
        t_end = full_timings[end_idx]["end"] + args.pad_seconds
        s0, s1 = int(t_start * sample_rate), min(waveform.shape[1], int(t_end * sample_rate))
        clip = waveform[:, s0:s1]

        snippet_clean_words = [clean(w) for w in snippet_words]
        golden = align(clip, model, tokenizer, aligner, snippet_clean_words, sample_rate)

        wav_path = os.path.join(args.out_dir, f"{name}.wav")
        sf.write(wav_path, clip.squeeze(0).numpy(), sample_rate, subtype="PCM_16")

        json_path = os.path.join(args.out_dir, f"{name}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"words": snippet_clean_words, "golden": golden}, f, indent=2)

        print(f"{name}: {n} words, {clip.shape[1] / sample_rate:.2f}s -> {wav_path}")


if __name__ == "__main__":
    main()
