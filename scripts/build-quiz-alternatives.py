"""Index dictionary senses and pronunciations that overlap quiz options."""

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
RARE = {"archaic", "dated", "eye-dialect", "misspelling", "obsolete", "rare"}


def normalize(text):
    return " ".join(unicodedata.normalize("NFC", text).lower().replace("’", "'").replace("‘", "'").split())


def meaning_keys(text):
    phrases = re.split(r"[,;/]|\s+or\s+", re.sub(r"\([^)]*\)", "", normalize(text)))
    return {key for phrase in phrases
            if (key := re.sub(r"^(?:to|a|an|the)\s+", "", phrase.strip()).rstrip(".?!").strip())}


def indexed_entries(dictionary, surfaces):
    with dictionary.open(encoding="utf-8") as stream:
        for line in stream:
            entry = json.loads(line)
            surface = normalize(entry["word"])
            if surface in surfaces:
                yield surface, entry


def build(words, dictionary):
    surfaces = defaultdict(list)
    for word in words:
        surface = normalize(word["nl"])
        if word["kind"] == "noun":
            surface = re.sub(r"^(?:de|het) ", "", surface)
        surfaces[surface].append(word["id"])

    displayed = {word["id"]: meaning_keys(word["en"]) for word in words}
    vocabulary = Counter(key for keys in displayed.values() for key in keys)
    indexes = defaultdict(lambda: {"meanings": set(), "sounds": set()})
    for surface, entry in indexed_entries(dictionary, surfaces):
        meanings = set()
        for sense in entry.get("senses", []):
            if sense.get("form_of") or sense.get("alt_of") or RARE.intersection(sense.get("tags", [])):
                continue
            for gloss in sense.get("glosses", [])[-1:]:
                meanings.update(meaning_keys(gloss) & vocabulary.keys())
        sounds = {
            re.sub(r"[/.ˈˌ\[\] ]", "", sound["ipa"])
            for sound in entry.get("sounds", [])
            if "ipa" in sound and not RARE.intersection(sound.get("tags", []))
        }
        for card_id in surfaces[surface]:
            indexes[card_id]["meanings"].update(meanings - displayed[card_id])
            indexes[card_id]["sounds"].update(sounds)

    shared = Counter(sound for entry in indexes.values() for sound in entry["sounds"])
    colliding = {sound for sound, count in shared.items() if sound and count > 1}
    entries = {}
    for card_id, evidence in sorted(indexes.items()):
        values = {"meanings": sorted(evidence["meanings"]), "sounds": sorted(evidence["sounds"] & colliding)}
        if any(values.values()):
            entries[card_id] = {key: value for key, value in values.items() if value}
    return entries


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dictionary", type=Path)
    args = parser.parse_args()
    words = json.loads((ROOT / "content/words.json").read_text(encoding="utf-8"))
    output = build(words, args.dictionary)
    (ROOT / "content/quiz-alternatives.json").write_text(
        json.dumps(output, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(f"Indexed alternate meanings or shared pronunciations for {len(output)} cards.")
