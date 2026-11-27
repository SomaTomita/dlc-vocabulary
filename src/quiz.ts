type Card = {
  id: string;
  nl: string;
  en: string;
  kind: string;
  topic: string;
  forms: { label: string; text: string }[];
};

type Alternatives = Record<string, { meanings?: string[]; sounds?: string[] }>;

export function normalize(text: string) {
  return text.normalize('NFC').trim().toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
}

export function meaningKeys(text: string): string[] {
  return normalize(text).replace(/\([^)]*\)/g, '').split(/[,;/]|\s+or\s+/)
    .map(phrase => phrase.trim().replace(/^(?:to|a|an|the)\s+/, '').replace(/[.?!]+$/, '').trim())
    .filter(Boolean);
}

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const partner = Math.floor(Math.random() * (index + 1));
    [result[index], result[partner]] = [result[partner], result[index]];
  }
  return result;
}

export function createQuiz(cards: Card[], alternatives: Alternatives = {}) {
  const dutch = new Map(cards.map(card => [card.id, normalize(card.nl)]));
  const english = new Map(cards.map(card => [card.id, normalize(card.en)]));
  const glosses = new Map(cards.map(card => [card.id, new Set(meaningKeys(card.en))]));
  const possibleMeanings = new Map(cards.map(card => [card.id, new Set([
    ...meaningKeys(card.en), ...(alternatives[card.id]?.meanings ?? []),
  ])]));
  const sounds = new Map(cards.map(card => [card.id, new Set(alternatives[card.id]?.sounds)]));
  const lemmas = new Map(cards.map(card => [
    card.id, normalize(card.forms.find(form => form.label === 'Base form')?.text ?? card.nl),
  ]));

  function isPlausibleAnswer(word: Card, other: Card, inverse: boolean, listening: boolean) {
    if (word.id === other.id || lemmas.get(word.id) === lemmas.get(other.id)) return true;
    const labels = inverse ? dutch : english;
    if (labels.get(word.id) === labels.get(other.id)) return true;
    if (listening && [...sounds.get(other.id)!].some(sound => sounds.get(word.id)!.has(sound))) return true;
    return [...glosses.get(other.id)!].some(meaning => possibleMeanings.get(word.id)!.has(meaning))
      || [...glosses.get(word.id)!].some(meaning => possibleMeanings.get(other.id)!.has(meaning));
  }

  function candidates(word: Card, inverse: boolean, listening: boolean) {
    const labels = inverse ? dutch : english;
    const displayKey = (card: Card) => labels.get(card.id)!;
    const pool = inverse ? cards.filter(card => card.kind === 'ordinal') : cards;
    const blocked = new Set(pool.filter(card => isPlausibleAnswer(word, card, inverse, listening)).map(displayKey));
    return pool.filter(card => !blocked.has(displayKey(card)));
  }

  function choices(word: Card, inverse: boolean, listening: boolean) {
    const eligible = candidates(word, inverse, listening);
    const sameKind = eligible.filter(other => other.kind === word.kind);
    const sameTopic = eligible.filter(other => other.kind !== word.kind && other.topic === word.topic);
    const remaining = eligible.filter(other => other.kind !== word.kind && other.topic !== word.topic);
    const display = (card: Card) => inverse ? card.nl : card.en;
    const unique = new Set([normalize(display(word))]);
    const options = [display(word)];
    for (const other of [...shuffle(sameKind), ...shuffle(sameTopic), ...shuffle(remaining)]) {
      const value = display(other);
      const key = normalize(value);
      if (unique.has(key)) continue;
      unique.add(key);
      options.push(value);
      if (options.length === 4) break;
    }
    return shuffle(options);
  }

  return { choices, isPlausibleAnswer };
}
