# Dutch Vocabulary

[Open practice](https://somatomita.github.io/dlc-vocabulary/)

The deck has 2,192 study entries, including larger numbers from Lessons 9 and 10. A source review of 807 flagged readings confirmed 35 for the deck and ruled out 633. Another 139 OCR-only readings lacked source confirmation and were left out. Checking the original pages also recovered five entries outside that review set. The source index records 2,191 Dutch candidates and selected expressions.

## Development

Run `npm ci` and `npm run dev`. Run `npm run build` to validate the content and build the static site. GitHub Actions deploys `dist/` from `main` to Pages. To roll back, revert the relevant commit on `main`.

## Add cards

Add a reviewed entry to `content/words.json`, with a stable ID and a source locator. Define reusable review groups in `content/review.json`. Keep IDs unchanged when correcting an existing card. Generate any missing audio, then run the build.

Audio is generated with the Belgian Flemish [Piper rdh medium voice](https://huggingface.co/rhasspy/piper-voices/tree/main/nl/nl_BE/rdh/medium). The [Piper voice licensing notes](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/LICENSING.md) identify the underlying rdh dataset as CC0. With Piper and ffmpeg installed, download the voice with `python -m piper.download_voices nl_BE-rdh-medium` and run `python scripts/generate-audio.py /path/to/nl_BE-rdh-medium.onnx`.


## Import course vocabulary

Run source extraction in the course notes repository and use the resulting `data-work/` index with the Dutch JSONL export from [Kaikki](https://kaikki.org/dictionary/Dutch/).

```sh
python3 scripts/import-course.py /path/to/data-work /path/to/dutch.jsonl \
  --cache /path/to/extraction-cache --audit /tmp/course-audit.tsv --write
```

The import preserves manually authored cards and stable IDs, matches observed word forms to dictionary entries, and records an outcome for every observation. Put corrections in `content/course-glossary.json`. Generate missing clips and run `npm run build` before publishing.

### Vocabulary attribution

The dictionary-derived content in `content/words.json` is adapted from [English Wiktionary contributors](https://en.wiktionary.org/) through the [Kaikki Dutch export](https://kaikki.org/dictionary/Dutch/) and is available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adaptations include selecting course forms, shortening glosses and adding grammar labels. Each dictionary-derived card links to its source entry from **Word details**.
