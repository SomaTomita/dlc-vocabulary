import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const read = name => JSON.parse(readFileSync(new URL('../content/' + name + '.json', import.meta.url), 'utf8'));
const words = read('words');
const groups = read('review');
const numbers = read('numbers');
const audio = read('audio');
const alternatives = read('quiz-alternatives');
const reviewedMeanings = read('course-meanings');
assert.equal(audio.locale, 'nl-BE');
assert.ok(words.length >= 4);
assert.equal(new Set(words.map(word => word.id)).size, words.length, 'Card IDs must be unique');
const ids = new Set(words.map(word => word.id));
const cardsById = new Map(words.map(word => [word.id, word]));
const spellings = new Set(words.map(word => word.nl));
for (const word of words) {
  assert.match(word.id, /^[a-z0-9-]+$/);
  assert.ok(word.nl && word.en && word.topic && word.kind && word.source.file && word.source.location);
  for (const group of word.groups) assert.ok(groups[group], 'Unknown group ' + group);
}
for (const group of Object.values(groups)) {
  for (const member of group.members ?? []) assert.ok(spellings.has(member), 'Unknown review member ' + member);
}
for (const id of Object.keys(alternatives)) assert.ok(ids.has(id), 'Quiz evidence for an unknown card ' + id);
for (const [id, fields] of Object.entries(reviewedMeanings)) {
  const card = cardsById.get(id);
  assert.ok(card, 'Meaning override for an unknown card ' + id);
  for (const [key, value] of Object.entries(fields)) assert.deepEqual(card[key], value, 'Stale meaning override for ' + id);
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

const quizSource = readFileSync(new URL('../src/quiz.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(quizSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { createQuiz, normalize } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const quiz = createQuiz(words, alternatives);
const byDutch = Map.groupBy(words, word => normalize(word.nl));
const byEnglish = Map.groupBy(words, word => normalize(word.en));
const card = text => byDutch.get(text)[0];
assert.ok(quiz.isPlausibleAnswer(card('de achternaam'), card('de familienaam'), false, false));
assert.ok(quiz.isPlausibleAnswer(card('jou'), card('jouw'), false, true));
assert.ok(quiz.isPlausibleAnswer(card('zei'), card('zij'), false, true));
for (const word of words) {
  for (const listening of [false, true]) {
    const inverse = !listening && word.kind === 'ordinal';
    const answer = normalize(inverse ? word.nl : word.en);
    const choices = quiz.choices(word, inverse, listening).map(normalize);
    assert.equal(choices.length, 4, 'Too few choices for ' + word.nl);
    assert.equal(new Set(choices).size, 4, 'Duplicate choices for ' + word.nl);
    assert.ok(choices.includes(answer), 'Missing answer for ' + word.nl);
    const labels = inverse ? byDutch : byEnglish;
    for (const choice of choices.filter(option => option !== answer)) {
      const cards = labels.get(choice);
      assert.ok(cards?.length, 'Unknown choice ' + choice);
      assert.ok(cards.every(card => !quiz.isPlausibleAnswer(word, card, inverse, listening)),
        'Another plausible answer for ' + word.nl + ' is ' + choice);
    }
  }
}
console.log(`Checked all ${words.length * 2} four-choice and listening prompts for conflicting answers.`);
