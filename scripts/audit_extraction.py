"""Cross-check the extracted word index against the current source snapshot."""

import argparse
from collections import Counter
import csv
import json
from pathlib import Path

from extract_sources import digest, source_files
from index_words import CANDIDATE_STATUSES, read_json


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_sources(root, coverage):
    current = {relative: path for path, relative in source_files(root)}
    sources = {item["id"]: item for item in coverage["sources"]}
    snapshot = {item["path"]: item for item in sources.values()}
    require(len(snapshot) == len(coverage["sources"]), "Duplicate source ID or path")
    missing = current.keys() - snapshot.keys()
    removed = snapshot.keys() - current.keys()
    require(not (missing or removed), f"Added: {sorted(missing)}; removed: {sorted(removed)}")
    for relative, record in snapshot.items():
        require(record["kind"] in {"pdf", "text"},
                f"Unsupported or failed extraction: {relative} ({record['kind']})")
        require(digest(current[relative]) == record["sha256"], f"Changed source: {relative}")
    return sources


def verify_pages(sources, pages, require_ocr):
    expected = {(source, n) for source, data in sources.items() if data["kind"] == "pdf"
                for n in range(1, data["pages"] + 1)}
    actual = {(page["source"], page["page"]) for page in pages}
    require(len(actual) == len(pages) and actual == expected, "PDF page coverage mismatch")
    missing_ocr = [page for page in pages if "ocr" not in page["word_counts"]]
    for page in pages:
        missing = page["forms_missing_from_visual_check"]
        require(not missing, f"Missing forms in the visual check for source {page['source']} "
                             f"page {page['page']}: {', '.join(missing)}")
    if require_ocr:
        require(not missing_ocr, f"OCR missing on {len(missing_ocr)} PDF pages")
    return len(missing_ocr)


def verify_index(data, sources, pages):
    by_page = {(page["source"], page["page"]): page for page in pages}
    statuses = {}
    occurrences = 0
    with (data / "word-index.jsonl").open(encoding="utf-8") as stream:
        for row in map(json.loads, stream):
            form = row["form"]
            require(form not in statuses and row["spellings"] and row["refs"],
                    f"Duplicate or incomplete entry: {form}")
            statuses[form] = row["status"]
            for ref in row["refs"]:
                source = sources[ref["source"]]
                require(bool(ref["locations"]), f"No location for {form}")
                for loc in ref["locations"]:
                    occurrences += 1
                    if source["kind"] == "pdf":
                        page = by_page.get((source["id"], loc))
                        require(page is not None and page["word_counts"].get(ref["method"], 0) > 0,
                                f"Invalid PDF reference for {form}: {source['path']} page {loc}")
                    else:
                        require(ref["method"] == "text" and 1 <= loc <= source["lines"],
                                f"Invalid text reference for {form}: {source['path']} line {loc}")

    for file, included_statuses in (
        ("dutch-candidates.tsv", CANDIDATE_STATUSES),
        ("review-queue.tsv", set(statuses.values()) - CANDIDATE_STATUSES - {"english-context"}),
    ):
        expected = {form: status for form, status in statuses.items() if status in included_statuses}
        with (data / file).open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream, delimiter="\t"))
        actual = {row["form"]: row["status"] for row in rows}
        require(len(actual) == len(rows) and actual == expected, f"Index mismatch in {file}")
    return Counter(statuses.values()), occurrences


def audit(root, data, require_ocr):
    coverage = read_json(data / "coverage.json")
    sources = verify_sources(root, coverage)
    pages = coverage["pages"]
    pending_ocr = verify_pages(sources, pages, require_ocr)
    counts, occurrences = verify_index(data, sources, pages)
    require(dict(counts) == coverage["candidate_counts"], "Word status totals do not match")
    print(json.dumps({
        "sources": dict(Counter(source["kind"] for source in sources.values())),
        "pdf_pages": len(pages),
        "pages_awaiting_ocr": pending_ocr,
        "pages_without_detected_words": sum(page["empty_both"] for page in pages),
        "pages_awaiting_visual_review": sum(page["visual_review"] == "pending" for page in pages),
        "indexed_forms_and_expressions": sum(counts.values()),
        "source_locators": occurrences,
        "statuses": dict(counts),
    }, indent=2))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--source-root", required=True, type=Path)
    cli.add_argument("--data", required=True, type=Path)
    cli.add_argument("--require-ocr", action="store_true")
    args = cli.parse_args()
    audit(args.source_root, args.data, args.require_ocr)
