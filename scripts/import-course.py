"""Match observed course word forms to Dutch entries in a Kaikki JSONL export."""

import argparse
from collections import Counter, defaultdict
import csv
from hashlib import sha256
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
KINDS = {
    "noun": "noun", "verb": "verb", "adj": "adjective", "prep": "preposition",
    "prep_phrase": "preposition", "phrase": "phrase", "intj": "phrase",
    "num": "cardinal", "name": "word", "adv": "word", "article": "word",
    "conj": "word", "pron": "word", "det": "word", "contraction": "word",
    "postp": "preposition", "particle": "word", "circumpos": "preposition",
}
RARE = {"obsolete", "archaic", "dated", "nonstandard", "rare", "misspelling", "eye-dialect"}
LAYERS = {"text", "visual", "pdf-text", "pdf-raw"}
PREFERRED = {"visually-verified", "dutch-candidate", "expression", "dutch-context-review"}
DUTCH_HINTS = set("aan als bij dat de deze die dit door een en geen heeft het hier hij hoe hun ik is je jij kan maar met mijn moet naar niet ook op te uit van veel voor waar wat welk zijn zonder".split())
ENGLISH_HINTS = set("a about an and are at be been for from had has have if in into is it its of on or she that the this those to was were what when where which who with would you your".split())
TOKEN = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿĀ-ſḀ-ỿ]+(?:[-'][A-Za-zÀ-ÖØ-öø-ÿĀ-ſḀ-ỿ]+)*")
RANKING = ("visual", "pdf-text", "pdf-raw", "text", "ocr", "ocr-block")
GLOSS_LIMIT = 115


def norm(text):
    return unicodedata.normalize("NFC", text.translate(str.maketrans("’‘‐‑", "''--"))).casefold()


def lines(path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            yield json.loads(line)


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def gloss(sense):
    if RARE.intersection(sense.get("tags", [])) or sense.get("alt_of"):
        return None
    candidates = [g.strip() for g in sense.get("glosses", []) if g.strip()]
    if not candidates:
        return None
    text = candidates[-1].removesuffix(".").strip()
    if sense.get("form_of"):
        parts = text.split("; ", 1)
        return parts[1] if "pronominal" in sense.get("tags", []) and len(parts) == 2 else None
    if len(text) > GLOSS_LIMIT and " (" in text:
        text = text.split(" (", 1)[0]
    return text


def dictionary(path, forms):
    direct = defaultdict(list)
    inflected = defaultdict(list)
    base_needed = set()
    for entry in lines(path):
        if entry.get("pos") not in KINDS:
            continue
        word = norm(entry["word"])
        if word in forms:
            direct[word].append(entry)
            for sense in entry.get("senses", []):
                for base in sense.get("form_of", []) + sense.get("alt_of", []):
                    base_needed.add(norm(base["word"]))
        for item in entry.get("forms", []):
            spelling = norm(item["form"])
            tags = set(item.get("tags", []))
            if spelling != word and spelling in forms and tags.intersection({
                "plural", "comparative", "superlative", "past", "present", "participle",
                "diminutive", "attributive",
            }) and not tags.intersection(RARE):
                inflected[spelling].append((entry, tags))
    base = defaultdict(list)
    for entry in lines(path):
        if norm(entry["word"]) in base_needed and entry.get("pos") in KINDS:
            base[norm(entry["word"])].append(entry)
    return direct, inflected, base


def english(entry):
    options = []
    for sense in entry.get("senses", []):
        text = gloss(sense)
        if not text or len(text) > GLOSS_LIMIT:
            continue
        if text not in options:
            options.append(text)
        if len(options) == 2:
            break
    return options


def description(tags):
    for key, value in (
        ("participle", "participle"), ("imperative", "imperative form"),
        ("past", "past-tense form"), ("plural", "plural"), ("comparative", "comparative"),
        ("superlative", "superlative"), ("diminutive", "diminutive"), ("attributive", "attributive form"),
    ):
        if key in tags:
            return value
    return "inflected form"


def lexical_match(form, direct, inflected, base):
    choices = []
    for entry in direct.get(form, []):
        meanings = english(entry)
        if meanings and entry["pos"] != "name":
            choices.append((entry["word"], entry["pos"], meanings[0], entry, None))
        elif meanings and not any(
            marker in meanings[0].casefold() for marker in ("given name", "surname", "family name")
        ):
            choices.append((entry["word"], entry["pos"], meanings[0], entry, None))
        for sense in entry.get("senses", []):
            tags = set(sense.get("tags", []))
            if tags & RARE:
                continue
            for relation in sense.get("form_of", []):
                for origin in base.get(norm(relation["word"]), []):
                    defs = english(origin)
                    if origin["pos"] == entry["pos"] and defs:
                        choices.append((entry["word"], entry["pos"],
                                        f"{defs[0]} ({description(tags)})", origin, tags))
                        break
    if not choices:
        for entry, tags in inflected.get(form, []):
            meanings = english(entry)
            if meanings and entry["pos"] != "name":
                choices.append((form, entry["pos"], f"{meanings[0]} ({description(tags)})", entry, tags))
    if not choices:
        return None
    # Prefer a direct vocabulary meaning to an incidental verbal or nominal homograph.
    return min(choices, key=lambda item: (item[1] == "name", item[4] is not None))


def location(row, records):
    refs = sorted(row["refs"], key=lambda ref: (
        not records[ref["source"]]["path"].startswith("materials/"),
        RANKING.index(ref["method"]) if ref["method"] in RANKING else len(RANKING),
        ref["source"],
        ref["locations"][0],
    ))
    ref = refs[0]
    source = records[ref["source"]]
    locator = f"{'p.' if source['kind'] == 'pdf' else 'line'} {ref['locations'][0]}"
    return {"file": Path(source["path"]).name, "location": locator}


def source_context(rows, records, cache):
    dutch = set()
    english = set()
    if not cache:
        return dutch, english
    for source in records.values():
        examples = source["path"].startswith("materials/") and source["kind"] == "text"
        base = cache / f'v1-{source["sha256"]}'
        if source["kind"] == "pdf":
            files = sorted(base.glob("page-*.json"))
            text_chunks = (read(path) for path in files)
            passages = ((
                item["embedded"],
                item["ocr"]["text"] if item.get("ocr") and (item["ocr"]["confidence"] or 0) >= 84 else "",
            ) for item in text_chunks)
        else:
            passages = [(read(base / "note.json")["text"], "")]
        for embedded, optical in passages:
            for line in (embedded + "\n" + optical).splitlines():
                if "https://" in line:
                    continue
                normal = norm(line)
                if examples:
                    dutch.update(re.findall(r"([a-zà-ž]+(?:-[a-zà-ž]+)*)\s+[ァ-ヿ]", normal))
                terms = set(TOKEN.findall(normal))
                nl_score = len(terms & (DUTCH_HINTS - ENGLISH_HINTS))
                en_score = len(terms & (ENGLISH_HINTS - DUTCH_HINTS))
                if nl_score >= 1 and nl_score > en_score:
                    dutch.update(terms & rows.keys())
                elif en_score >= 2 and en_score > nl_score:
                    english.update(terms & rows.keys())
    return dutch, english


def forms_for(nl, pos, entry, form_tags):
    if form_tags:
        return [{"label": "Base form", "text": entry["word"]}]
    if pos == "noun":
        plurals = [item["form"] for item in entry.get("forms", [])
                   if "plural" in item.get("tags", []) and not RARE.intersection(item.get("tags", []))
                   and item["form"] != entry["word"] and TOKEN.fullmatch(item["form"])]
        return [{"label": "Plural", "text": "de " + plurals[0]}] if plurals else []
    if pos == "adj":
        result = []
        for label, tag in (("Comparative", "comparative"), ("Superlative", "superlative")):
            item = next((item for item in entry.get("forms", [])
                         if tag in item.get("tags", []) and not RARE.intersection(item.get("tags", []))
                         and item["form"] != nl and TOKEN.search(item["form"])), None)
            if item:
                result.append({"label": label, "text": item["form"]})
        return result
    if pos != "verb":
        return []
    result = []
    for label, tags in (
        ("Present", {"first-person", "singular", "present", "indicative"}),
        ("Past", {"singular", "past", "indicative"}),
        ("Past participle", {"participle", "past"}),
    ):
        for item in entry.get("forms", []):
            flags = set(item.get("tags", []))
            if tags <= flags and not (flags & (RARE | {"negative", "subordinate"})) and item["form"] != nl and TOKEN.search(item["form"]):
                result.append({"label": label, "text": item["form"]})
                break
    return result


def with_article(nl, pos, entry, tags):
    if pos != "noun" or tags:
        return nl
    templates = entry.get("head_templates", [])
    genders = {h.get("args", {}).get("1", "") for h in templates if h.get("name") == "nl-noun"}
    if genders and genders <= {"m", "f", "c", "mf", "m,f"}:
        return "de " + nl
    if genders == {"n"}:
        return "het " + nl
    return nl


def number_topic(pos):
    return ("word", "Numbers") if pos == "num" else (KINDS[pos], "Course vocabulary")


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("index_dir", type=Path)
    cli.add_argument("dictionary", type=Path)
    cli.add_argument("--cache", type=Path)
    cli.add_argument("--audit", type=Path, required=True)
    cli.add_argument("--ocr-confirmations", type=Path)
    cli.add_argument("--write", action="store_true")
    args = cli.parse_args()
    idx = {row["form"]: row for row in lines(args.index_dir / "word-index.jsonl")}
    records = {item["id"]: item for item in read(args.index_dir / "coverage.json")["sources"]}
    actual_dutch, actual_english = source_context(idx, records, args.cache)
    direct, inflected, base = dictionary(args.dictionary, set(idx))
    output = ROOT / "content/words.json"
    deck = [word for word in read(output) if not word.get("dictionary") and not word.get("imported")]
    existing = {norm(word["nl"]) for word in deck}
    for word in deck:
        if word["kind"] == "noun" and word["nl"].startswith(("de ", "het ")):
            existing.add(norm(word["nl"].split(" ", 1)[1]))
    authored = read(ROOT / "content/course-glossary.json")
    verified_ocr = set()
    if args.ocr_confirmations:
        for path in args.ocr_confirmations.glob("*.json"):
            verified_ocr.update(read(path)["matches"])
    review_groups = read(ROOT / "content/review.json")
    paired = {norm(dutch): group for group, info in review_groups.items()
              if group.startswith("pair-") for _, dutch, _ in info["rows"]}
    totals = Counter()
    collected = []
    visual_supplements = 0
    with args.audit.open("w", encoding="utf-8", newline="") as stream:
        report = csv.writer(stream, delimiter="\t")
        report.writerow(["form", "extraction_status", "decision", "file", "location", "reason"])
        for form, row in sorted(idx.items()):
            source = location(row, records)
            reason = ""
            channels = {ref["method"] for ref in row["refs"]}
            sightings = {(ref["source"], p) for ref in row["refs"] for p in ref["locations"]}
            match = lexical_match(form, direct, inflected, base)
            accepted = bool((channels & LAYERS and (row["status"] in PREFERRED or form in actual_dutch
                              or (match and form not in actual_english and source["file"].endswith(".pdf"))))
                            or (form in actual_dutch and (len(sightings) >= 2 or form in verified_ocr))
                            or (form in verified_ocr and len(form) >= 4 and form not in actual_english))
            if form in existing:
                decision = "existing"
            elif form in authored:
                nl, kind, en, *citation = authored[form]
                if citation:
                    source = citation[0]
                if kind == "exclude":
                    reason = en
                    decision = "unconfirmed-ocr" if en.startswith("OCR-only reading") else "excluded"
                else:
                    decision = "authored"
                    collected.append({"nl": nl, "kind": kind, "en": en, "forms": [], "groups": [],
                                      "topic": "Numbers" if kind in {"cardinal", "ordinal"} else "Course vocabulary"})
            elif match and accepted:
                nl, pos, en, entry, tags = match
                kind, topic = number_topic(pos)
                decision = "dictionary"
                collected.append({"nl": with_article(nl, pos, entry, tags), "kind": kind, "en": en,
                                  "forms": forms_for(nl, pos, entry, tags), "groups": [],
                                  "topic": topic, "dictionary": entry["word"]})
            elif match:
                decision = "check-source"
            elif row["status"] in PREFERRED and channels & LAYERS:
                decision = "check-gloss"
            else:
                decision = "no-lexical-match"
            if decision in {"authored", "dictionary"}:
                entry = collected[-1]
                entry.update(id="course-" + sha256(form.encode()).hexdigest()[:16], source=source)
                if form in paired:
                    entry["groups"].append(paired[form])
                if entry["kind"] == "preposition" and form in {"in", "op", "om", "naar", "bij", "aan"}:
                    entry["groups"].append("time-preps" if form == "om" else "place-preps")
                if decision == "authored":
                    entry["imported"] = True
            totals[decision] += 1
            report.writerow([form, row["status"], decision, source["file"], source["location"], reason])
        for form, (nl, kind, en, *citation) in sorted(authored.items()):
            if form in idx or form in existing or not citation or kind == "exclude":
                continue
            source = citation[0]
            collected.append({
                "id": "course-" + sha256(form.encode()).hexdigest()[:16], "nl": nl, "en": en,
                "kind": kind, "topic": "Course vocabulary", "source": source,
                "forms": [], "groups": [], "imported": True,
            })
            visual_supplements += 1
            report.writerow([form, "visual-supplement", "authored", source["file"], source["location"], "Directly read from the source"])
    if args.write:
        output.write_text(json.dumps(deck + collected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        previous = read(ROOT / "content/coverage.json")
        snapshot = read(args.index_dir / "coverage.json")
        candidate_statuses = ("dutch-candidate", "expression", "visually-verified")
        metadata = {
            "snapshot": previous["snapshot"],
            "pdfPages": len(snapshot["pages"]),
            "sourceWordCandidates": sum(snapshot["candidate_counts"].get(status, 0) for status in candidate_statuses),
            "indexedForms": len(idx),
            "visualSupplements": visual_supplements,
            "cardCount": len(deck) + len(collected),
            "audit": {"check-gloss": 0, "check-source": 0, "unconfirmed-ocr": 0, **dict(totals)},
        }
        (ROOT / "content/coverage.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(dict(totals))


if __name__ == "__main__":
    main()
