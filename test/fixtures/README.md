# Golden fixtures

The audio golden fixtures for `test/align.golden.test.ts` are intentionally
not checked in (only the `romanize/` text fixtures are). Generate them locally
from your own short audio clip + transcript. `align.golden.test.ts` discovers whatever
`*.wav`/`*.json` pairs exist here at test-run time and skips itself entirely
if none do, so a fresh clone's `npm test` doesn't fail for missing fixtures.

## Generating fixtures

Requires a Python environment with `torch`, `torchaudio`, and `soundfile`
installed — `torchaudio.pipelines.MMS_FA` is the reference implementation
this package's decode algorithm is validated against.

```bash
python scripts/generate_fixtures.py \
  --audio path/to/your_clip.wav \
  --transcript "Full transcript text spoken in that clip." \
  --snippet snippet-1 "First few words of the transcript." \
  --snippet snippet-2 "A different short phrase from later in the clip."
```

Each `--snippet NAME TEXT` must have `TEXT` appear verbatim inside
`--transcript`. This writes `snippet-1.wav`/`snippet-1.json` etc. into this
directory — a few seconds each, sourced from audio you have the rights to
use, is plenty. See `scripts/generate_fixtures.py`'s module docstring for
details on how each snippet's timing window is derived.
