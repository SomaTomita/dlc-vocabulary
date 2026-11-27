"""Cache native PDF text and OCR for every page, and text for every course note."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import file_digest
import json
import os
from pathlib import Path
import re
import subprocess
from tempfile import NamedTemporaryFile, TemporaryDirectory
import unicodedata

EXCLUDED_DIRECTORIES = {"exam/vocabulary-app", "exam/app-plan", "prep-notes"}
OCR_FORMAT = "tesseract-tsv-v2"


def run(*args):
    return subprocess.run(args, capture_output=True, check=True)


def save(path, data):
    with NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", delete=False) as stream:
        json.dump(data, stream, ensure_ascii=False)
        stream.write("\n")
        pending = Path(stream.name)
    pending.replace(path)


def digest(file):
    with file.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest()


def native_pdf(path, order="-layout"):
    metadata = run("pdfinfo", str(path)).stdout.decode(errors="replace")
    page_count = int(re.search(r"^Pages:\s*(\d+)", metadata, re.M).group(1))
    result = run("pdftotext", "-enc", "UTF-8", order, str(path), "-")
    pages = result.stdout.decode().split("\f")
    if pages[-1] == "":
        pages.pop()
    if len(pages) != page_count:
        pages = [
            run("pdftotext", "-f", str(n), "-l", str(n), "-nopgbrk",
                "-enc", "UTF-8", order, str(path), "-").stdout.decode()
            for n in range(1, page_count + 1)
        ]
    return pages, result.stderr.decode(errors="replace")


def recognise(images, tessdata, mode, languages):
    files = images[0].parent / f"{images[0].stem}-{mode}.txt"
    files.write_text("".join(f"{image}\n" for image in images), encoding="utf-8")
    result = run("tesseract", str(files), "stdout", "--tessdata-dir", str(tessdata),
                 "-l", languages, "--psm", str(mode), "-c", "tessedit_create_tsv=1")
    rows = result.stdout.decode().splitlines()
    if not rows or not rows[0].startswith("level\tpage_num\t"):
        raise ValueError("Tesseract did not return TSV")
    lines = {}
    scores = {}
    for row in rows[1:]:
        fields = row.split("\t", 11)
        if fields[0] == "1":
            lines[int(fields[1])] = {}
            scores[int(fields[1])] = []
        if len(fields) != 12 or fields[0] != "5" or not fields[11].strip():
            continue
        page = int(fields[1])
        score = float(fields[10])
        if score >= 0:
            scores[page].append(score)
        lines[page].setdefault(tuple(fields[2:5]), []).append(fields[11])
    if list(lines) != list(range(1, len(images) + 1)):
        raise ValueError("Tesseract did not return every requested page")
    return [{
        "text": "\n".join(" ".join(line) for line in lines[page].values()),
        "words": len(scores[page]),
        "confidence": round(sum(scores[page]) / len(scores[page]), 1) if scores[page] else None,
    } for page in lines]


def render_and_ocr(path, pages, cache, tessdata, pool, reuse=None, quick=False):
    def cached(number):
        dst = cache / f"page-{number}.json"
        if dst.exists() and json.loads(dst.read_text()).get("ocr_format") == OCR_FORMAT:
            return True
        if reuse is not None:
            other = reuse / cache.name / dst.name
            if other.exists():
                reused = json.loads(other.read_text())
                if reused.get("ocr_format") == OCR_FORMAT and reused["embedded"] == pages[number - 1]:
                    save(dst, reused)
                    return True
        return False

    remaining = [number for number in range(1, len(pages) + 1) if not cached(number)]
    if not remaining:
        return ""
    with TemporaryDirectory(prefix="render-", dir=cache) as work:
        prefix = Path(work) / "page"
        scale = "1200" if quick else "1800"
        languages = "nld" if quick else "nld+eng"
        result = run("pdftoppm", "-scale-to", scale, "-gray", "-jpeg",
                     "-jpegopt", "quality=91", str(path), str(prefix))
        images = {
            int(img.stem.rsplit("-", 1)[1]): img for img in Path(work).glob("page-*.jpg")
        }
        if sorted(images) != list(range(1, len(pages) + 1)):
            raise ValueError(f"Missing rendered pages: {path}")

        def read_block(numbers):
            results = recognise([images[n] for n in numbers], tessdata, 11, languages)
            retry = [n for n, result in zip(numbers, results)
                     if len(pages[n - 1].strip()) < 80
                     and (result["words"] < 6 or (result["confidence"] or 0) < 70)]
            detailed_images = []
            for number in retry:
                detail = Path(work) / f"detail-{number}"
                run("pdftoppm", "-f", str(number), "-l", str(number), "-singlefile",
                    "-scale-to", "1800", "-gray", "-jpeg", str(path), str(detail))
                detailed_images.append(detail.with_suffix(".jpg"))
            alternates = dict(zip(retry, recognise(detailed_images, tessdata, 6, "nld+eng"))) if retry else {}
            for number, primary in zip(numbers, results):
                save(cache / f"page-{number}.json",
                     {"page": number, "embedded": pages[number - 1], "ocr": primary,
                      "alternate": alternates.get(number), "ocr_scale": int(scale),
                      "ocr_format": OCR_FORMAT, "ocr_languages": languages})

        blocks = [remaining[start:start + 5] for start in range(0, len(remaining), 5)]
        list(pool.map(read_block, blocks))
        return result.stderr.decode(errors="replace")


def cache_native_pages(pages, entry_cache):
    for number, raw in enumerate(pages, 1):
        save(entry_cache / f"page-{number}.json",
             {"page": number, "embedded": raw, "ocr": None, "alternate": None})


def may_be_source(path):
    name = path.name.casefold()
    if name.startswith((".env", ".")) or path.suffix.casefold() in {".key", ".pem", ".p12", ".pfx"}:
        return False
    return not any(word in name for word in ("credentials", "secrets", "private-key"))


def source_files(root):
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if (path.is_file() and not path.is_symlink()
                and not any(part.startswith(".") for part in rel.parts)
                and may_be_source(path)
                and not any(rel.as_posix().startswith(f"{prefix}/")
                            for prefix in EXCLUDED_DIRECTORIES)):
            yield path, unicodedata.normalize("NFC", rel.as_posix())


def snapshot_changes(before, after):
    previous = {item["path"]: item.get("sha256") for item in before}
    current = {item["path"]: item.get("sha256") for item in after}
    added = set(current) - previous.keys()
    removed = set(previous) - current.keys()
    moved = []
    for old_path in sorted(removed):
        old_hash = previous[old_path]
        matches = [path for path in added if old_hash and current[path] == old_hash]
        if len(matches) == 1 and sum(previous[p] == old_hash for p in removed) == 1:
            new_path = matches[0]
            moved.append({"from": old_path, "to": new_path})
            added.remove(new_path)
    moved_from = {item["from"] for item in moved}
    return {
        "added": sorted(added),
        "changed": sorted(path for path in previous.keys() & current.keys()
                          if previous[path] != current[path]),
        "moved": moved,
        "removed": sorted(removed - moved_from),
    }


def collect(args):
    root = args.source_root.resolve()
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    inventory_path = cache / "inventory.json"
    previous_inventory = json.loads(inventory_path.read_text()) if inventory_path.exists() else []
    inventory = []
    os.environ.setdefault("OMP_THREAD_LIMIT", "1")
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for path, relative_path in sorted(source_files(root), reverse=args.reverse):
            record = {"path": relative_path}
            try:
                if path.suffix.lower() in {".pdf", ".md", ".txt"}:
                    key = digest(path)
                    record["sha256"] = key
                    entry_cache = cache / f"v1-{key}"
                    entry_cache.mkdir(exist_ok=True)
                    complete = entry_cache / "source.json"
                    previous = json.loads(complete.read_text()) if complete.exists() else {}
                    needs_ocr = (path.suffix.lower() == ".pdf" and not args.native_only
                                 and previous.get("ocr_format") != OCR_FORMAT)
                    if not previous or needs_ocr:
                        if path.suffix.lower() == ".pdf":
                            pages, text_warning = native_pdf(path)
                            if args.native_only:
                                cache_native_pages(pages, entry_cache)
                                render_warning = ""
                            else:
                                render_warning = render_and_ocr(
                                    path, pages, entry_cache, args.tessdata, pool,
                                    reuse=args.reuse_ocr_cache, quick=args.quick,
                                )
                            save(complete, {"kind": "pdf", "pages": len(pages),
                                            "warnings": (text_warning + render_warning).splitlines(),
                                            "ocr_format": None if args.native_only else OCR_FORMAT})
                        else:
                            save(entry_cache / "note.json", {"text": path.read_text(encoding="utf-8-sig")})
                            save(complete, {"kind": "text", "warnings": []})
                    record.update(json.loads(complete.read_text()))
                    if record["kind"] == "pdf":
                        raw_cache = entry_cache / "raw-order.json"
                        if not raw_cache.exists():
                            raw_pages, _ = native_pdf(path, "-raw")
                            save(raw_cache, raw_pages)
                elif path.suffix.lower() in {".mp3", ".m4a", ".wav"}:
                    record["kind"] = "audio-only"
                else:
                    record["kind"] = "unsupported"
            except (subprocess.SubprocessError, OSError, ValueError) as exc:
                record["kind"] = "error"
                record["error"] = str(exc)
            inventory.append(record)
            print(record["kind"], record.get("pages", ""), record["path"], flush=True)
    save(inventory_path, sorted(inventory, key=lambda record: record["path"]))
    print(json.dumps(snapshot_changes(previous_inventory, inventory), ensure_ascii=False))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--source-root", required=True, type=Path)
    cli.add_argument("--cache", required=True, type=Path)
    cli.add_argument("--tessdata", required=True, type=Path)
    cli.add_argument("--jobs", type=int, default=8)
    cli.add_argument("--native-only", action="store_true", help="Use a separate cache for this text-only pass.")
    cli.add_argument("--reuse-ocr-cache", type=Path)
    cli.add_argument("--reverse", action="store_true")
    cli.add_argument("--quick", action="store_true", help="Use a smaller Dutch OCR render plus detailed retries.")
    collect(cli.parse_args())
