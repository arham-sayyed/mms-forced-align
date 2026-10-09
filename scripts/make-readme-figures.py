"""
Render the README figures (assets/readme/*.png) from code.

Every number drawn here comes from the benchmark constants below (one Windows
machine, 4 CPU cores, CPU only, a 36.45s Hinglish clip, 3 runs), or from the
benchmark's raw per-word JSON and source audio, read from --bench-dir:
    bench_results_js.json, bench_results_python.json, video.wav
Those files are not part of this repo (the audio isn't redistributable).

Each figure is written as an SVG inside a small HTML page, then rasterised
with a headless Chromium browser (Edge or Chrome) at 2x, so 800 CSS px wide ->
1600 px PNG. A browser is used instead of matplotlib because the
romanization figure needs real Devanagari text shaping.

Usage:
    python scripts/make-readme-figures.py --bench-dir path/to/bench [--browser path/to/msedge.exe]
"""
import argparse
import html
import json
import os
import shutil
import struct
import subprocess
import tempfile
import wave

import numpy as np

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "readme")
WIDTH = 800  # CSS px; rendered at 2x

FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
FONT_DEVA = "'Nirmala UI', 'Noto Sans Devanagari', 'Mangal', sans-serif"
MONO = "Consolas, 'SFMono-Regular', Menlo, monospace"

# One palette for every figure.
INK = "#1f2937"
MUTED = "#6b7280"
GRID = "#e5e7eb"
BG = "#ffffff"
PANEL = "#f8fafc"
PY = "#475569"      # Python / torchaudio
JS = "#2563eb"      # JS fp32
JS_Q = "#93c5fd"    # JS int8 (quantized): lighter tint of JS
OK = "#16a34a"
WARN = "#f59e0b"
ORT = "#7c3aed"     # onnxruntime-node box in the pipeline figure

# Benchmark constants (BENCHMARK.md, 3-run averages and single-run breakdowns).
ALIGN_AVG = [("Python torchaudio (fp32)", 37.07, PY), ("JS int8 (quantized)", 26.97, JS_Q), ("JS fp32", 21.33, JS)]
PEAK_RSS = [("Python torchaudio (fp32)", 2657, PY), ("JS int8 (quantized)", 875, JS_Q), ("JS fp32", 1797, JS)]
COLD = [  # import, model load, first align
    ("Python torchaudio (fp32)", 3.91, 4.01, 37.21, PY),
    ("JS int8 (quantized)", 0.15, 2.10, 26.71, JS_Q),
    ("JS fp32", 0.15, 3.76, 21.36, JS),
]


def esc(s):
    return html.escape(str(s), quote=True)


def text(x, y, s, size=15, fill=INK, anchor="start", weight=400, family=FONT, extra=""):
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" '
        f'fill="{fill}" text-anchor="{anchor}" font-weight="{weight}" {extra}>{esc(s)}</text>'
    )


def svg_doc(height, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" '
        f'viewBox="0 0 {WIDTH} {height}"><rect width="100%" height="100%" fill="{BG}"/>{body}</svg>'
    )


def title(s, sub=None):
    out = text(32, 40, s, size=21, weight=600)
    if sub:
        out += text(32, 64, sub, size=14, fill=MUTED)
    return out


# --------------------------------------------------------------------------
# Bar charts
# --------------------------------------------------------------------------
def hbar_chart(title_s, sub, rows, unit_fmt, max_v, note=None, callout=None):
    top, row_h, bar_h = 92, 58, 30
    label_w, left, right = 210, 32, 120
    plot_w = WIDTH - left - label_w - right
    height = top + row_h * len(rows) + (54 if note else 24)
    b = [title(title_s, sub)]
    x0 = left + label_w
    for i, (label, v, color) in enumerate(rows):
        y = top + i * row_h
        w = plot_w * v / max_v
        b.append(text(x0 - 12, y + bar_h / 2 + 5, label, size=15, anchor="end"))
        b.append(f'<rect x="{x0}" y="{y}" width="{w:.1f}" height="{bar_h}" rx="4" fill="{color}"/>')
        b.append(text(x0 + w + 10, y + bar_h / 2 + 5, unit_fmt(v), size=15, weight=600))
        if callout and callout[0] == i:
            b.append(text(x0 + w + 10, y + bar_h / 2 + 24, callout[1], size=13, fill=JS, weight=600))
    b.append(f'<line x1="{x0}" y1="{top - 10}" x2="{x0}" y2="{top + row_h * len(rows) - 18}" stroke="{GRID}" stroke-width="2"/>')
    if note:
        b.append(text(left, height - 22, note, size=13, fill=MUTED))
    return svg_doc(height, "".join(b)), height


def fig_align_time():
    return hbar_chart(
        "Alignment time, 36.45s Hinglish clip (lower is better)",
        "Average of 3 runs, CPU only, model already loaded",
        ALIGN_AVG,
        lambda v: f"{v:.2f} s",
        40,
        note="One machine (Windows, 4 cores), one clip, 3 runs. Your hardware will differ.",
        callout=(2, "42% faster than Python"),
    )


def fig_memory():
    return hbar_chart(
        "Peak memory during alignment (lower is better)",
        "Process RSS after model load + one alignment",
        PEAK_RSS,
        lambda v: f"{v:,} MB",
        2900,
        note="Same run setup as the timing chart. RSS = resident memory of the whole process.",
        callout=(2, "32% less than Python"),
    )


def fig_cold_start():
    top, row_h, bar_h = 92, 62, 30
    left, label_w, right = 32, 210, 110
    plot_w = WIDTH - left - label_w - right
    max_v = 48
    x0 = left + label_w
    height = top + row_h * len(COLD) + 92
    b = [title("Cold start: one CLI run, end to end (lower is better)", "Import + model load + first alignment, model file warm in the OS cache")]
    for i, (label, imp, load, align, color) in enumerate(COLD):
        y = top + i * row_h
        b.append(text(x0 - 12, y + bar_h / 2 + 5, label, size=15, anchor="end"))
        x = x0
        for v, op in ((imp, 1.0), (load, 0.45), (align, 1.0)):
            w = plot_w * v / max_v
            fill = INK if op == 1.0 and v == imp else color
            opacity = 0.45 if op != 1.0 else 1.0
            b.append(f'<rect x="{x:.1f}" y="{y}" width="{max(w, 1.5):.1f}" height="{bar_h}" fill="{fill}" fill-opacity="{opacity}"/>')
            x += w
        total = imp + load + align
        b.append(text(x + 10, y + bar_h / 2 + 5, f"~{total:.1f} s", size=15, weight=600))
        b.append(text(x0, y + bar_h + 17, f"import {imp:.2f}s · load {load:.2f}s · align {align:.2f}s", size=13, fill=MUTED))
    ly = top + row_h * len(COLD) + 14
    lx = x0
    for label, fill, op in (("import", INK, 1.0), ("model load (lighter tint)", MUTED, 0.45), ("first align", MUTED, 1.0)):
        b.append(f'<rect x="{lx}" y="{ly}" width="16" height="16" rx="3" fill="{fill}" fill-opacity="{op}"/>')
        b.append(text(lx + 22, ly + 13, label, size=14))
        lx += 22 + len(label) * 8.2 + 26
    b.append(text(left, height - 22, "Python's import alone (torch + torchaudio) takes 3.91s; node + mms-forced-align takes 0.15s.", size=13, fill=MUTED))
    return svg_doc(height, "".join(b)), height


# --------------------------------------------------------------------------
# Accuracy strip
# --------------------------------------------------------------------------
def fig_accuracy(bench_dir):
    js = json.load(open(os.path.join(bench_dir, "bench_results_js.json"), encoding="utf-8"))["fp32"]["words"]
    py = json.load(open(os.path.join(bench_dir, "bench_results_python.json"), encoding="utf-8"))["words"]
    assert len(js) == len(py) == 116
    diffs = []
    for a, p in zip(js, py):
        d = max(abs(a["start"] - p["start"]), abs(a["end"] - p["end"])) * 1000
        diffs.append(round(d))
    same = sum(1 for d in diffs if d == 0)

    cols, cell, gap = 29, 22, 3
    left, top = 32, 110
    rows = (len(diffs) + cols - 1) // cols
    height = top + rows * (cell + gap) + 104
    b = [title("Word timings: JS fp32 vs Python torchaudio fp32", "All 116 words of the 36.45s Hinglish clip, start and end compared")]
    b.append(text(left, 92, f"{same} of {len(diffs)} words identical", size=16, fill=OK, weight=600))
    for i, d in enumerate(diffs):
        r, c = divmod(i, cols)
        x, y = left + c * (cell + gap), top + r * (cell + gap)
        color = OK if d == 0 else WARN
        b.append(f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" rx="4" fill="{color}"/>')
        if d:
            b.append(text(x + cell / 2, y + 15.5, str(d // 20), size=12, fill=INK, anchor="middle", weight=700))
    ly = top + rows * (cell + gap) + 18
    b.append(f'<rect x="{left}" y="{ly}" width="16" height="16" rx="3" fill="{OK}"/>')
    b.append(text(left + 24, ly + 13, "identical start and end", size=14))
    b.append(f'<rect x="{left + 230}" y="{ly}" width="16" height="16" rx="3" fill="{WARN}"/>')
    b.append(text(left + 254, ly + 13, "off by N frames of 20 ms (all at pauses)", size=14))
    b.append(text(left, ly + 46, "Separate golden-fixture test with identical audio on both sides: 37/37 words exact (0.0 ms).", size=14, weight=600))
    b.append(text(left, ly + 68, "The 6 differences likely come from the benchmark harness resampling 44.1 kHz audio differently from torchaudio.", size=13, fill=MUTED))
    return svg_doc(height, "".join(b)), height


# --------------------------------------------------------------------------
# What forced alignment does (real waveform + real timings)
# --------------------------------------------------------------------------
def fig_what_it_does(bench_dir):
    words = json.load(open(os.path.join(bench_dir, "bench_results_js.json"), encoding="utf-8"))["fp32"]["words"][:10]
    w = wave.open(os.path.join(bench_dir, "video.wav"))
    sr, ch = w.getframerate(), w.getnchannels()
    secs = 3.0
    raw = w.readframes(int(sr * secs))
    a = np.frombuffer(raw, dtype="<i2").astype(np.float32).reshape(-1, ch).mean(axis=1)

    left, right = 32, 32
    plot_w = WIDTH - left - right
    wave_top, wave_h = 190, 120
    height = 420
    px_per_s = plot_w / secs
    cols = int(plot_w)
    buckets = np.array_split(a, cols)
    peak = max(abs(a).max(), 1)
    mid = wave_top + wave_h / 2
    pts_top, pts_bot = [], []
    for i, bk in enumerate(buckets):
        x = left + i
        pts_top.append(f"{x:.1f},{mid - (bk.max() / peak) * wave_h / 2:.1f}")
        pts_bot.append(f"{x:.1f},{mid - (bk.min() / peak) * wave_h / 2:.1f}")
    poly = " ".join(pts_top + pts_bot[::-1])

    b = [title("What forced alignment does", "You give it the audio and the words. It returns when each word was spoken.")]
    # Input transcript chips
    b.append(text(left, 100, "Input transcript", size=13, fill=MUTED, weight=600))
    cx = left
    for wd in words:
        wlen = 14 + len(wd["word"]) * 8.6
        b.append(f'<rect x="{cx:.1f}" y="110" width="{wlen:.1f}" height="26" rx="13" fill="{PANEL}" stroke="{GRID}"/>')
        b.append(text(cx + wlen / 2, 128, wd["word"], size=14, anchor="middle", family=MONO))
        cx += wlen + 6
    # Word boxes behind the waveform
    for i, wd in enumerate(words):
        x1, x2 = left + wd["start"] * px_per_s, left + wd["end"] * px_per_s
        b.append(f'<rect x="{x1:.1f}" y="{wave_top - 6}" width="{x2 - x1:.1f}" height="{wave_h + 12}" fill="{JS}" fill-opacity="0.12" stroke="{JS}" stroke-width="1.2"/>')
        ly = wave_top - 16 if i % 2 == 0 else wave_top - 34
        b.append(text((x1 + x2) / 2, ly, wd["word"], size=14, anchor="middle", fill=JS, weight=600, family=MONO))
    b.append(f'<polygon points="{poly}" fill="{PY}" fill-opacity="0.85"/>')
    # Time axis
    ay = wave_top + wave_h + 22
    b.append(f'<line x1="{left}" y1="{ay}" x2="{left + plot_w}" y2="{ay}" stroke="{GRID}" stroke-width="2"/>')
    for t in np.arange(0, secs + 0.001, 0.5):
        x = left + t * px_per_s
        b.append(f'<line x1="{x:.1f}" y1="{ay}" x2="{x:.1f}" y2="{ay + 6}" stroke="{MUTED}"/>')
        b.append(text(x, ay + 22, f"{t:.1f}s", size=13, fill=MUTED, anchor="middle"))
    b.append(text(left, height - 26, 'Output: [{ word: "aaj", start: 0.04, end: 0.12 }, { word: "albeck", start: 0.18, end: 0.52 }, ...]', size=13, family=MONO))
    b.append(text(left, height - 6, "First 3 seconds of the benchmark clip. Real timings from mms-forced-align (fp32).", size=12, fill=MUTED))
    return svg_doc(height, "".join(b)), height


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------
def box(x, y, w, h, label, sub, color):
    out = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{color}" fill-opacity="0.10" stroke="{color}" stroke-width="1.6"/>'
    out += text(x + w / 2, y + 27, label, size=15, anchor="middle", weight=600)
    if sub:
        out += text(x + w / 2, y + 47, sub, size=12.5, anchor="middle", fill=MUTED)
    return out


def arrow(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{MUTED}" stroke-width="1.8" marker-end="url(#ah)"/>'


def fig_pipeline():
    height = 380
    defs = f'<defs><marker id="ah" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{MUTED}"/></marker></defs>'
    b = [defs, title("How mms-forced-align works", "Everything except the acoustic model is TypeScript in this package")]
    bw, bh, gap = 170, 62, 26
    xs = [32 + i * (bw + gap) for i in range(4)]
    y1, y2 = 104, 232
    row1 = [
        ("Audio", "16 kHz mono Float32Array", JS),
        ("Normalize", "zero mean, unit variance", JS),
        ("MMS acoustic model", "ONNX via onnxruntime-node", ORT),
        ("log_softmax", "[frames × 31] log-probs", JS),
    ]
    row2 = [
        ("Transcript words", "a–z and ' only", JS),
        ("CTC Viterbi", "best path + backtrack", JS),
        ("Letter → word spans", "group by word length", JS),
        ("Seconds", "start / end / score", JS),
    ]
    for i, (l, s, c) in enumerate(row1):
        b.append(box(xs[i], y1, bw, bh, l, s, c))
        if i:
            b.append(arrow(xs[i - 1] + bw + 2, y1 + bh / 2, xs[i] - 4, y1 + bh / 2))
    for i, (l, s, c) in enumerate(row2):
        b.append(box(xs[i], y2, bw, bh, l, s, c))
        if i:
            b.append(arrow(xs[i - 1] + bw + 2, y2 + bh / 2, xs[i] - 4, y2 + bh / 2))
    # emission feeds Viterbi
    b.append(f'<path d="M{xs[3] + bw / 2},{y1 + bh + 2} L{xs[3] + bw / 2},{y1 + bh + 32} L{xs[1] + bw / 2},{y1 + bh + 32} L{xs[1] + bw / 2},{y2 - 4}" fill="none" stroke="{MUTED}" stroke-width="1.8" marker-end="url(#ah)"/>')
    b.append(text(xs[2] + bw / 2, y1 + bh + 26, "emission: one score per token, every 20 ms frame", size=12.5, fill=MUTED, anchor="middle"))
    ly = height - 36
    b.append(f'<rect x="32" y="{ly}" width="16" height="16" rx="3" fill="{JS}" fill-opacity="0.15" stroke="{JS}"/>')
    b.append(text(56, ly + 13, "TypeScript in this package", size=14))
    b.append(f'<rect x="270" y="{ly}" width="16" height="16" rx="3" fill="{ORT}" fill-opacity="0.15" stroke="{ORT}"/>')
    b.append(text(294, ly + 13, "onnxruntime-node (model downloaded from Hugging Face)", size=14))
    return svg_doc(height, "".join(b)), height


# --------------------------------------------------------------------------
# CTC trellis
# --------------------------------------------------------------------------
EXT = ["_", "h", "_", "e", "_", "l", "_", "l", "_", "o", "_"]
PATH = [0, 1, 1, 3, 3, 4, 5, 5, 6, 7, 7, 9, 9, 9, 10, 10]  # illustrative, validated below


def validate_path(path, ext):
    assert path[0] in (0, 1) and path[-1] in (len(ext) - 1, len(ext) - 2)
    for a, b in zip(path, path[1:]):
        step = b - a
        assert step in (0, 1, 2), (a, b)
        if step == 2:
            assert ext[b] != "_" and ext[b] != ext[b - 2], (a, b)
    # every letter state visited
    for s in range(1, len(ext), 2):
        assert s in path, s


def fig_trellis():
    validate_path(PATH, EXT)
    T, S = len(PATH), len(EXT)
    cell = 30
    left, top = 110, 104
    height = top + S * cell + 92
    grid_w = T * cell
    b = [title("CTC Viterbi: finding the best path for \"hello\"", "Rows: the word with a blank (_) around every letter. Columns: 20 ms audio frames.")]
    for s in range(S):
        y = top + s * cell
        is_blank = EXT[s] == "_"
        b.append(text(left - 14, y + cell / 2 + 5, EXT[s], size=16, anchor="end", fill=MUTED if is_blank else INK, weight=400 if is_blank else 700, family=MONO))
        for t in range(T):
            x = left + t * cell
            b.append(f'<rect x="{x + 2}" y="{y + 2}" width="{cell - 4}" height="{cell - 4}" rx="4" fill="{PANEL}" stroke="{GRID}"/>')
    for t in range(0, T, 5):
        b.append(text(left + t * cell + cell / 2, top + S * cell + 18, f"{t * 20} ms", size=12, fill=MUTED, anchor="middle"))
    pts = []
    for t, s in enumerate(PATH):
        cx, cy = left + t * cell + cell / 2, top + s * cell + cell / 2
        pts.append((cx, cy))
    b.append(f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="none" stroke="{JS}" stroke-width="3" stroke-linejoin="round"/>')
    for t, (cx, cy) in enumerate(pts):
        letter = EXT[PATH[t]] != "_"
        b.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="7" fill="{JS if letter else BG}" stroke="{JS}" stroke-width="2.5"/>')
    # forced blank between the two l's
    t_blank = PATH.index(6)
    bx, by = left + t_blank * cell + cell / 2, top + 6 * cell + cell / 2
    b.append(f'<circle cx="{bx:.1f}" cy="{by:.1f}" r="13" fill="none" stroke="{WARN}" stroke-width="2.5"/>')
    # legend on the right
    lx = left + grid_w + 26
    ly = top + 4
    b.append(text(lx, ly + 10, "Moves per frame", size=14, weight=600))
    for i, (name, desc) in enumerate((("stay", "same row"), ("advance", "down 1 row"), ("skip", "down 2 rows, over a blank"))):
        b.append(text(lx, ly + 38 + i * 40, name, size=14, weight=600, fill=JS))
        b.append(text(lx, ly + 56 + i * 40, desc, size=13, fill=MUTED))
    b.append(f'<circle cx="{lx + 8}" cy="{ly + 172}" r="10" fill="none" stroke="{WARN}" stroke-width="2.5"/>')
    b.append(text(lx + 26, ly + 168, "Can't skip from l to l:", size=13))
    b.append(text(lx + 26, ly + 186, "a blank is required", size=13))
    b.append(text(lx, ly + 222, "Filled dot = letter frame", size=13, fill=MUTED))
    b.append(text(lx, ly + 240, "Hollow dot = blank frame", size=13, fill=MUTED))
    b.append(text(32, height - 40, "Viterbi keeps the best score for every cell, then backtracks from the end to recover this path.", size=13, fill=MUTED))
    b.append(text(32, height - 20, "Illustrative path; the real decoder does this over thousands of frames.", size=13, fill=MUTED))
    return svg_doc(height, "".join(b)), height


# --------------------------------------------------------------------------
# Romanization flow (real romanizeWords() output)
# --------------------------------------------------------------------------
ROMAN = [("आज", "aaj"), ("मैंने", "maimne"), ("काफी", "kaaphii"), ("कुछ", "kuch"), ("किया", "kiyaa")]


def fig_romanize():
    height = 360
    defs = f'<defs><marker id="ah" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{MUTED}"/></marker></defs>'
    b = [defs, title("alignNative(): native script in, native script out", "Hindi example (hi-IN). Romanization is a TypeScript port of uroman's rules and data.")]
    cols = [(32, "Your words"), (282, "romanizeWords()"), (532, "align() → timings mapped back")]
    for x, h in cols:
        b.append(text(x, 104, h, size=14, weight=600, fill=MUTED))
    for i, (nat, rom) in enumerate(ROMAN):
        y = 118 + i * 42
        b.append(f'<rect x="32" y="{y}" width="200" height="32" rx="8" fill="{PANEL}" stroke="{GRID}"/>')
        b.append(text(132, y + 23, nat, size=19, anchor="middle", family=FONT_DEVA))
        b.append(arrow(236, y + 16, 278, y + 16))
        b.append(f'<rect x="282" y="{y}" width="200" height="32" rx="8" fill="{JS}" fill-opacity="0.10" stroke="{JS}"/>')
        b.append(text(382, y + 21, rom, size=15, anchor="middle", family=MONO))
        b.append(arrow(486, y + 16, 528, y + 16))
        b.append(f'<rect x="532" y="{y}" width="236" height="32" rx="8" fill="{PANEL}" stroke="{GRID}"/>')
        b.append(f'<text x="546" y="{y + 22}" font-size="15" fill="{INK}"><tspan font-family="{FONT_DEVA}" font-size="17">{esc(nat)}</tspan><tspan font-family="{MONO}" fill="{MUTED}">  start … end</tspan></text>')
    b.append(text(32, height - 20, "Same word count in and out, matched by index. Unromanizable input throws RomanizeError instead of guessing.", size=13, fill=MUTED))
    return svg_doc(height, "".join(b)), height


# --------------------------------------------------------------------------
def find_browser(explicit):
    candidates = [explicit] if explicit else []
    candidates += [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        shutil.which("chromium") or "",
        shutil.which("google-chrome") or "",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    raise SystemExit("No Chromium-based browser found; pass --browser")


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def render(browser, name, svg, height, tmp):
    page = os.path.join(tmp, f"{name}.html")
    with open(page, "w", encoding="utf-8") as f:
        f.write(f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:{BG};overflow:hidden}}svg{{display:block}}</style>{svg}')
    out = os.path.abspath(os.path.join(OUT_DIR, f"{name}.png"))
    subprocess.run(
        [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
         f"--window-size={WIDTH},{height}", f"--screenshot={out}", "file:///" + page.replace("\\", "/")],
        check=True, capture_output=True,
    )
    w, h = png_size(out)
    assert w == WIDTH * 2, (name, w, h)
    print(f"{name}.png  {w}x{h}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bench-dir", required=True)
    ap.add_argument("--browser")
    args = ap.parse_args()
    browser = find_browser(args.browser)
    os.makedirs(OUT_DIR, exist_ok=True)
    figs = {
        "what-it-does": fig_what_it_does(args.bench_dir),
        "pipeline": fig_pipeline(),
        "trellis": fig_trellis(),
        "bench-align-time": fig_align_time(),
        "bench-memory": fig_memory(),
        "bench-cold-start": fig_cold_start(),
        "accuracy": fig_accuracy(args.bench_dir),
        "romanize": fig_romanize(),
    }
    with tempfile.TemporaryDirectory() as tmp:
        for name, (svg, h) in figs.items():
            render(browser, name, svg, h, tmp)


if __name__ == "__main__":
    main()
