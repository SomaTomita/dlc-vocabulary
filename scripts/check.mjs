import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = name => JSON.parse(readFileSync(new URL('../content/' + name + '.json', import.meta.url), 'utf8'));
const words = read('words');
const groups = read('review');
const numbers = read('numbers');
const audio = read('audio');
assert.equal(audio.locale, 'nl-BE');
assert.ok(words.length >= 4);
assert.equal(new Set(words.map(word => word.id)).size, words.length, 'Card IDs must be unique');
for (const word of words) {
  assert.match(word.id, /^[a-z0-9-]+$/);
  assert.ok(word.nl && word.en && word.topic && word.kind && word.source.file && word.source.location);
  for (const group of word.groups) assert.ok(groups[group], 'Unknown group ' + group);
}
const spoken = new Set([
  ...words.flatMap(word => [word.nl, ...word.forms.map(form => form.text)]),
  ...Object.values(groups).flatMap(group => group.rows.map(row => row[1])),
  ...numbers.flatMap(([, cardinal, ordinal]) => [cardinal, ordinal]),
]);
for (const text of spoken) {
  const clip = audio.clips[text];
  assert.match(clip ?? '', /^[a-f0-9]{16}\.mp3$/, 'Missing audio for ' + text);
  const file = new URL('../public/audio/' + clip, import.meta.url);
  assert.ok(statSync(file).size > 256, 'Empty audio for ' + text);
}
console.log(`Validated ${words.length} study entries and ${spoken.size} Belgian Dutch clips.`);
