"""Generate missing Belgian Dutch clips with Piper rdh medium and ffmpeg."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import wave

from piper import PiperVoice

root = Path(__file__).resolve().parents[1]
cli = argparse.ArgumentParser(description=__doc__)
cli.add_argument("model", type=Path)
args = cli.parse_args()
words = json.loads((root / "content/words.json").read_text())
groups = json.loads((root / "content/review.json").read_text())
numbers = json.loads((root / "content/numbers.json").read_text())
texts = {word["nl"] for word in words}
texts.update(form["text"] for word in words for form in word["forms"])
texts.update(row[1] for group in groups.values() for row in group["rows"])
texts.update(text for _, cardinal, ordinal, _ in numbers for text in (cardinal, ordinal))
voice = PiperVoice.load(args.model)
clips = {}
output = root / "public/audio"
output.mkdir(exist_ok=True, parents=True)
with TemporaryDirectory() as work:
    wav = Path(work) / "word.wav"
    for text in sorted(texts):
        spoken = "[[s]]" if text == "'s" else text.replace("; ", ". ")
        key = hashlib.sha256(("rdh-medium:" + (spoken if text == "'s" else text)).encode()).hexdigest()[:16] + ".mp3"
        target = output / key
        if not target.is_file() or target.stat().st_size <= 256:
            with wave.open(str(wav), "wb") as handle:
                voice.synthesize_wav(spoken, handle)
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(wav),
                            "-c:a", "libmp3lame", "-b:a", "48k", str(target)], check=True)
        clips[text] = key
(root / "content/audio.json").write_text(
    json.dumps({"locale": "nl-BE", "voice": "Piper rdh medium", "clips": clips}, ensure_ascii=False, indent=2) + "\n"
)
print(f"{len(clips)} clips")
