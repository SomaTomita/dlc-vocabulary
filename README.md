# Dutch Vocabulary

[Open practice](https://somatomita.github.io/dlc-vocabulary/)

The initial deck contains 206 reviewed study entries. The course extraction contains 2,191 candidates and selected expressions. Coverage review is ongoing.

## Development

Run `npm ci` and `npm run dev`. Run `npm run build` to validate the content and build the static site. GitHub Actions deploys `dist/` from `main` to Pages. To roll back, revert the relevant commit on `main`.

## Add cards

Add a reviewed entry to `content/words.json`, with a stable ID and a source locator. Define reusable review groups in `content/review.json`. Keep IDs unchanged when correcting an existing card. Generate any missing audio, then run the build.

Audio is generated with the Belgian Flemish [Piper rdh medium voice](https://huggingface.co/rhasspy/piper-voices/tree/main/nl/nl_BE/rdh/medium). The [Piper voice licensing notes](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/LICENSING.md) identify the underlying rdh dataset as CC0. With Piper and ffmpeg installed, download the voice with `python -m piper.download_voices nl_BE-rdh-medium` and run `python scripts/generate-audio.py /path/to/nl_BE-rdh-medium.onnx`.
