"""Build an auditable inventory of written Dutch forms from the extraction cache."""

import argparse
from collections import Counter, defaultdict
import csv
from hashlib import file_digest
import json
from pathlib import Path
import re
import unicodedata

from extract_sources import OCR_FORMAT

CANDIDATE_STATUSES = {"dutch-candidate", "expression", "visually-verified"}
LATIN = r"A-Za-zÀ-ÖØ-öø-ÿĀ-ſḀ-ỿ"
WORD = re.compile(rf"(?:'(?=[tsn]\b))?[{LATIN}]+(?:['-][{LATIN}]+)*", re.I)
WRAPPED = re.compile(rf"(?m)([{LATIN}]{{2,}})-[ \t]*\n[ \t]*([a-zà-öø-ÿ][{LATIN}]{{1,}})")
URL = re.compile(r"https?://[^\s)>]+|(?<=\])\([^)]+\)|[\w.+-]+@[\w.-]+\.[a-z]{2,}", re.I)
TAG = re.compile(r"</?[a-z][a-z0-9-]*(?:\s+[^<>]*)?>", re.I)
NL = set("aan als ben bent bij daar dat de deze die dit doe doen een en er geen gaan gehad "
         "heb hebben heeft het hij hoe hun ik in is ja je jij jou jouw kan kun maar met mijn "
         "naar nee niet nog nu of om ons onze ook op over te tot uit van veel voor waar waarom "
         "wanneer wat we wel welk welke wie wij wil wordt ze zich zij zijn zo zou jullie u uw".split())
EN = set("a an and are as at be been both but by can could did do does for from had has have "
         "he her his how if in into is it its may more of on one or our she so some than that "
         "the their them then there these they this those to too under up was we were what when "
         "where which who will with would you your".split())
EXPRESSIONS = (
    "aangenaam kennis te maken", "bekend om", "doen aan", "een beetje", "hoe gaat het",
    "hoe heet je", "hoe oud ben je", "ik kom uit", "ik woon in", "in de namiddag",
    "in de voormiddag", "in het weekend", "van beroep", "waar woon je",
    "kijken naar", "op bezoek", "op stap", "tot ziens", "waar kom je vandaan",
    "zullen we", "'s avonds", "'s middags", "'s morgens", "'s nachts", "'s ochtends",
)
TRANSLATION = str.maketrans("’‘ʼ‐‑–—", "'''--  ")
LIGATURES = str.maketrans({"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl",
                          "Ĳ": "IJ", "ĳ": "ij", "\u00ad": ""})


def normalise(text):
    return unicodedata.normalize("NFC", text).translate(TRANSLATION).translate(LIGATURES)


def key(text):
    return normalise(text).casefold()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class Candidate:
    def __init__(self):
        self.spellings = set()
        self.refs = defaultdict(set)
        self.contexts = set()

    def add(self, spelling, source_id, location, channel, context):
        self.spellings.add(spelling)
        self.refs[source_id, channel].add(location)
        self.contexts.add(context)

    @property
    def channels(self):
        return {channel for _, channel in self.refs}

    def locations(self):
        return [{"source": source, "method": method, "locations": sorted(locations)}
                for (source, method), locations in sorted(self.refs.items())]


def add_line(index, text, source, location, channel, expressions, detect_markup=False):
    text = normalise(URL.sub(" ", text))
    if detect_markup:
        text = TAG.sub(" ", text)
    words = WORD.findall(text)
    terms = [word.casefold() for word in words]
    nl = sum(t in NL - EN for t in terms)
    en = sum(t in EN - NL for t in terms)
    context = "nl" if nl > en and nl > 0 else "en" if en > nl else "mixed"
    for spelling, form in zip(words, terms):
        index[form].add(spelling, source, location, channel, context)
    if len(terms) > 1:
        joined = " ".join(terms)
        for phrase in expressions.findall(joined):
            index[phrase].add(phrase, source, location, channel, context)
    return len(terms)


def add_wrapped_forms(index, text, source, page, channel, dictionary):
    found = 0
    for left, right in WRAPPED.findall(normalise(text)):
        for spelling in (left + right, left + "-" + right):
            form = key(spelling)
            if form in dictionary:
                index[form].add(spelling, source, page, channel, "mixed")
                found += 1
    return found


def label(form, entry, dictionary, english):
    if "visual" in entry.channels:
        return "visually-verified"
    if form in EXPRESSIONS:
        return "expression"
    if len(form) == 1 and form not in {"u", "à"}:
        return "single-letter-review"
    if form in dictionary or form in NL:
        if ("nl" in entry.contexts
                or (form not in english and form not in EN)):
            return "dutch-candidate"
        return "dictionary-context-review"
    if form in english and "nl" not in entry.contexts:
        return "english-context"
    if "nl" in entry.contexts:
        return "dutch-context-review"
    return "unclassified-review"


def index_cache(cache, output, dictionary_file, english_file, ocr_cache, visual_checks):
    dictionary = {key(line.strip()) for line in dictionary_file.read_text(encoding="utf-8-sig").splitlines()}
    english = {key(line.strip()) for line in english_file.read_text(encoding="utf-8").splitlines()}
    expressions = re.compile(r"(?<!\S)(?:" + "|".join(map(re.escape, EXPRESSIONS)) + r")(?!\S)")
    index = defaultdict(Candidate)
    inventory = read_json(cache / "inventory.json")
    visual_by_hash = {review["sha256"]: review for review in visual_checks.values()}
    pages = []
    for source_id, record in enumerate(inventory, 1):
        record["id"] = source_id
        if record["kind"] not in {"pdf", "text"}:
            continue
        base = cache / f"v1-{record['sha256']}"
        if record["kind"] == "text":
            lines = read_json(base / "note.json")["text"].splitlines()
            record["lines"] = len(lines)
            for line_no, line in enumerate(lines, 1):
                add_line(index, line, source_id, line_no, "text", expressions, detect_markup=True)
            continue
        raw_pages = read_json(base / "raw-order.json")
        checked_source = visual_by_hash.get(record["sha256"], {})
        checked_pages = checked_source.get("pages", {})
        if len(raw_pages) != record["pages"]:
            raise ValueError(f"Incorrect raw text page count for {record['path']}")
        for n in range(1, record["pages"] + 1):
            page = read_json(base / f"page-{n}.json")
            if ocr_cache is not None:
                supplement = ocr_cache / base.name / f"page-{n}.json"
                if supplement.exists():
                    ocr_page = read_json(supplement)
                    if ocr_page["embedded"] != page["embedded"]:
                        raise ValueError(f"Conflicting extraction for {record['path']} page {n}")
                    page = ocr_page
            if page["page"] != n:
                raise ValueError(f"Unexpected page number for {record['path']} page {n}")
            inputs = {"pdf-text": page["embedded"], "pdf-raw": raw_pages[n - 1]}
            if page["ocr"] is not None:
                if page.get("ocr_format") != OCR_FORMAT:
                    raise ValueError(f"Invalid OCR cache for {record['path']} page {n}")
                inputs["ocr"] = page["ocr"]["text"]
            if page["alternate"] is not None:
                inputs["ocr-block"] = page["alternate"]["text"]
            counts = {
                channel: sum(add_line(index, line, source_id, n, channel, expressions)
                             for line in value.splitlines())
                for channel, value in inputs.items()
            }
            for channel, value in inputs.items():
                wrap_channel = channel + "-join"
                wrapped = add_wrapped_forms(index, value, source_id, n, wrap_channel, dictionary)
                if wrapped:
                    counts[wrap_channel] = wrapped
            native = {key(word) for channel, value in inputs.items() if channel.startswith("pdf-")
                      for word in WORD.findall(normalise(value))}
            ocr = {key(word) for channel, value in inputs.items() if channel.startswith("ocr")
                   for word in WORD.findall(normalise(value))}
            expected = {key(spelling): spelling for spelling in checked_pages.get(str(n), [])}
            recovered = sorted(expected.keys() - (native | ocr))
            for form, spelling in expected.items():
                index[form].add(spelling, source_id, n, "visual", "nl")
            if expected:
                counts["visual"] = len(expected)
            pages.append({"source": source_id, "page": n, "word_counts": counts,
                          "ocr_confidence": page["ocr"]["confidence"] if page["ocr"] else None,
                          "ocr_render_pixels": page.get("ocr_scale"),
                          "ocr_languages": page.get("ocr_languages"),
                          "visual_review": "checked" if str(n) in checked_pages else "pending",
                          "visual_reference_forms": len(expected),
                          "forms_missing_from_visual_check": (
                              recovered if checked_source.get("require_machine_match") else []
                          ),
                          "manually_recovered_forms": recovered,
                          "extra_ocr_dictionary_forms": sorted((ocr - native) & dictionary),
                          "empty_both": not any(counts.values())})

    output.mkdir(parents=True, exist_ok=True)
    totals = Counter()
    fields = ("form", "status", "methods", "original_spellings", "sample_source", "page_or_line")
    with ((output / "word-index.jsonl").open("w", encoding="utf-8") as full,
          (output / "dutch-candidates.tsv").open("w", encoding="utf-8", newline="") as likely,
          (output / "review-queue.tsv").open("w", encoding="utf-8", newline="") as review):
        likely_writer = csv.writer(likely, delimiter="\t", lineterminator="\n")
        review_writer = csv.writer(review, delimiter="\t", lineterminator="\n")
        likely_writer.writerow(fields)
        review_writer.writerow(fields)
        for form, entry in sorted(index.items()):
            status = label(form, entry, dictionary, english)
            if status in CANDIDATE_STATUSES and all(
                method.startswith("ocr") or method.endswith("-join") for method in entry.channels
            ):
                status = ("ocr-only-review" if all(method.startswith("ocr") for method in entry.channels)
                          else "wrapped-text-review")
            refs = entry.locations()
            spellings = sorted(entry.spellings)
            full.write(json.dumps({"form": form, "status": status, "spellings": spellings,
                                   "refs": refs}, ensure_ascii=False, separators=(",", ":")) + "\n")
            first = min(refs, key=lambda ref: (
                ref["method"].startswith("ocr"), ref["source"], ref["locations"][0]))
            row = (form, status, ",".join(sorted(entry.channels)), " / ".join(spellings),
                   inventory[first["source"] - 1]["path"], first["locations"][0])
            if status in CANDIDATE_STATUSES:
                likely_writer.writerow(row)
            elif status != "english-context":
                review_writer.writerow(row)
            totals[status] += 1
    with dictionary_file.open("rb") as source:
        dict_hash = file_digest(source, "sha256").hexdigest()
    dump(output / "coverage.json", {"sources": inventory, "pages": pages,
                                    "candidate_counts": dict(sorted(totals.items())),
                                    "dictionary_sha256": dict_hash})


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--cache", required=True, type=Path)
    cli.add_argument("--output", required=True, type=Path)
    cli.add_argument("--dutch-dictionary", required=True, type=Path)
    cli.add_argument("--english-dictionary", type=Path, default=Path("/usr/share/dict/words"))
    cli.add_argument("--ocr-cache", type=Path, help="Merge page OCR into a complete native extraction.")
    cli.add_argument("--visual-checks", type=Path, help="Expected forms transcribed from reviewed pages.")
    args = cli.parse_args()
    checks = read_json(args.visual_checks) if args.visual_checks else {}
    index_cache(args.cache, args.output, args.dutch_dictionary, args.english_dictionary, args.ocr_cache, checks)
