import vocabulary from '../content/words.json';
import review from '../content/review.json';

export type Word = (typeof vocabulary)[number];
export const words = vocabulary;
export const groups: Record<string, { title: string; rows: string[][] }> = review;
export const allTopics = 'All topics';
export const withoutNumbers = 'All except numbers';
const wordKinds = { Nouns: 'noun', Verbs: 'verb', Adjectives: 'adjective' };
export const topics = [allTopics, withoutNumbers, ...Object.keys(wordKinds),
  ...[...new Set(words.map(word => word.topic))].filter(topic => !(topic in wordKinds))];

function matchesTopic(word: Word, topic: string): boolean {
  if (topic === allTopics) return true;
  if (topic === withoutNumbers) return word.topic !== 'Numbers';
  const kind = wordKinds[topic as keyof typeof wordKinds];
  return kind ? word.kind === kind : word.topic === topic;
}

export const topicCounts = Object.fromEntries(topics.map(topic => [
  topic, words.filter(word => matchesTopic(word, topic)).length,
]));

export function availableWords(selection: string[]) {
  const includedTopics = selection.filter(topic => topic !== withoutNumbers);
  return words.filter(word => (!selection.includes(withoutNumbers) || word.topic !== 'Numbers')
    && (includedTopics.length === 0 || includedTopics.some(topic => matchesTopic(word, topic))));
}

export type Mode = 'choice' | 'listen' | 'typing' | 'flashcards';
export type Rating = 'correct' | 'wrong' | 'reveal';
export type Review = { due: string; streak: number; missed: boolean; updatedAt?: number };
export type Session = {
  date: string;
  queue: string[];
  first?: string;
  question?: number;
  size?: number;
  target?: number;
  completed?: string[];
  missedWords?: string[];
  topic: string;
  topics?: string[];
  retries: Record<string, number>;
  options: string[];
  mode: Mode;
  selected?: string;
  result?: Rating;
};
export type Study = {
  history: Record<string, string[]>;
  review: Record<string, Review>;
  session?: Session;
  goal: number;
  activityReset?: number;
  studyReset?: number;
};

export const storageKey = 'dlc-vocabulary.study.v1';
export const tabKey = 'dlc-vocabulary.practice.v1';
export type TabPractice = { session: Session; input: string; flipped: boolean; studyReset?: number };
export const initialStudy: Study = { history: {}, review: {}, goal: 30 };
const byId = new Map(words.map(word => [word.id, word]));
export const getWord = (id: string | undefined) => id ? byId.get(id) : undefined;

export function localDay(offset = 0) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return [day.getFullYear(), day.getMonth() + 1, day.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-');
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function prompt(word: Word, mode: Mode) {
  if (mode === 'listen') return 'Listen and choose the meaning';
  if (mode === 'typing' || (word.kind === 'ordinal' && mode === 'choice')) return word.en;
  return word.nl;
}

export function expected(word: Word, mode: Mode) {
  return mode === 'typing' || (word.kind === 'ordinal' && mode === 'choice') ? word.nl : word.en;
}

export function normalize(text: string) {
  return text.normalize('NFC').trim().toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
}

function optionsFor(id: string | undefined, mode: Mode): string[] {
  const word = getWord(id);
  if (!word || mode === 'flashcards' || mode === 'typing') return [];
  const inverse = word.kind === 'ordinal' && mode === 'choice';
  const peers = words.filter(other => (other.kind === word.kind || (!inverse && other.topic === word.topic)) && other.id !== word.id);
  const sameKind = shuffle(peers.filter(other => other.kind === word.kind));
  const distractors = [...sameKind, ...shuffle(peers)].map(other => inverse ? other.nl : other.en);
  const answer = expected(word, mode);
  const excluded = new Set([answer, ...(word.kind === 'noun' && word.nl.includes('naam') ? ['surname', 'family name'] : [])]);
  return shuffle([answer, ...[...new Set(distractors)].filter(option => !excluded.has(option)).slice(0, 3)]);
}

export function selectedTopics(session: Session): string[] {
  return session.topics ?? (session.topic === allTopics ? [] : [session.topic]);
}

export function createSession(
  study: Study, selection: string[] = [], mode: Mode = 'choice', excluded: ReadonlySet<string> = new Set(),
): Session {
  const date = localDay();
  const practiced = new Set(study.history[date]);
  const pool = availableWords(selection).filter(word => !excluded.has(word.id));
  const previousFirst = study.session?.first ?? study.session?.queue[0];
  const ranked = pool.map(word => {
    const review = study.review[word.id];
    // Misses get a small edge without fixing the order of the next round.
    const weight = review?.missed ? 1.6 : !review || review.due <= date ? 1.2 : 1;
    return {
      word, priority: -Math.log(1 - Math.random()) / weight,
      alreadyPractised: practiced.has(word.id) && !review?.missed,
    };
  }).sort((a, b) => Number(a.alreadyPractised) - Number(b.alreadyPractised) || a.priority - b.priority);
  let selected = ranked.slice(0, study.goal);
  if (selection.length === 0) {
    const mainKinds = new Set(['verb', 'adjective', 'noun']);
    const included = new Set(ranked
      .filter(item => !item.alreadyPractised && mainKinds.has(item.word.kind))
      .slice(0, Math.ceil(study.goal * 0.7)));
    const numberLimit = Math.max(1, Math.floor(study.goal / 10));
    let numbers = 0;
    for (const item of ranked) {
      if (included.size === study.goal) break;
      if (item.word.topic === 'Numbers') {
        if (numbers === numberLimit) continue;
        numbers++;
      }
      included.add(item);
    }
    selected = ranked.filter(item => included.has(item));
  }
  const queue = selected.map(item => item.word.id);
  if (queue.length > 1 && queue[0] === previousFirst) {
    [queue[0], queue[1]] = [queue[1], queue[0]];
  }
  return {
    date, queue, first: queue[0], question: 1, size: queue.length, target: study.goal, completed: [], missedWords: [],
    topics: selection, topic: selection.length === 1 ? selection[0] : allTopics, mode, options: optionsFor(queue[0], mode), retries: {},
  };
}

export function changeTopics(study: Study, session: Session, selection: string[]): Session {
  const updated = { ...session, topics: selection, topic: selection.length === 1 ? selection[0] : allTopics };
  const current = session.queue[0];
  if (!current) return updated;
  const completed = session.completed ?? [];
  const seen = new Set([...completed, current]);
  const goal = Math.max(0, (session.target ?? study.goal) - seen.size);
  const remaining = createSession({ ...study, goal }, selection, session.mode, seen).queue;
  return { ...updated, queue: [current, ...remaining], size: seen.size + remaining.length, completed };
}

export function answer(study: Study, session: Session, grade: Rating, selected?: string): Study {
  const id = session.queue[0];
  if (!id || session.result) return study;
  const today = localDay();
  const previous = study.review[id];
  const missed = grade !== 'correct';
  const alreadyMissed = (session.retries[id] ?? 0) > 0;
  const streak = missed || alreadyMissed ? 0 : (previous?.streak ?? 0) + 1;
  const interval = missed || alreadyMissed ? 1 : [1, 3, 7, 14, 30][Math.min(streak - 1, 4)];
  const queue = [...session.queue];
  const retries = { ...session.retries };
  if (missed && (retries[id] ?? 0) < 2) {
    const gap = 4 + Math.floor(Math.random() * 3);
    queue.splice(Math.min(gap, queue.length), 0, id);
    retries[id] = (retries[id] ?? 0) + 1;
  }
  return {
    ...study,
    session: {
      ...session, queue, retries, result: grade, selected,
      completed: session.completed && [...new Set([...session.completed, id])],
      missedWords: grade === 'wrong' && session.missedWords
        ? [...new Set([...session.missedWords, id])]
        : session.missedWords,
    },
    review: { ...study.review, [id]: { due: localDay(interval), streak, missed: missed || alreadyMissed, updatedAt: Date.now() } },
    history: grade === 'reveal' ? study.history : {
      ...study.history, [today]: [...new Set([...(study.history[today] ?? []), id])],
    },
  };
}

export function next(session: Session): Session {
  const roundDone = session.size !== undefined && session.completed?.length === session.size;
  const queue = roundDone ? [] : session.queue.slice(1);
  return { ...session, queue, question: session.question === undefined ? undefined : session.question + 1, options: optionsFor(queue[0], session.mode), result: undefined, selected: undefined };
}

export function roundMistakes(ids: string[]) {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const word = getWord(id);
    if (!word) continue;
    const kind = Object.entries(wordKinds).find(([, value]) => word.kind === value)?.[0];
    const topic = word.topic === 'Numbers' ? 'Numbers' : kind ?? (
      word.kind === 'preposition' ? 'Prepositions' : word.topic
    );
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts].sort(([a, first], [b, second]) => second - first || a.localeCompare(b)).slice(0, 3);
}

export function mergeStudy(study: Study, saved: Study): Study {
  const history = { ...study.history };
  if ((study.activityReset ?? 0) === (saved.activityReset ?? 0)) {
    for (const [day, ids] of Object.entries(saved.history)) {
      history[day] = [...new Set([...ids, ...(history[day] ?? [])])];
    }
  }
  const review = { ...study.review };
  if ((study.studyReset ?? 0) === (saved.studyReset ?? 0)) {
    for (const [id, item] of Object.entries(saved.review)) {
      const current = review[id];
      if (!current || (item.updatedAt ?? 0) > (current.updatedAt ?? 0)) review[id] = item;
    }
  }
  return { ...study, history, review };
}

export function restoreTab(): TabPractice | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(tabKey) ?? 'null') as TabPractice | null;
    if (!saved || saved.session.date !== localDay() || saved.session.queue.some(id => !getWord(id))) return;
    return saved;
  } catch {
    return;
  }
}

export function restore(): [Study, boolean] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [initialStudy, true];
    const data = JSON.parse(raw) as Study;
    if (!data || !data.history || !data.review || !Number.isInteger(data.goal)
        || data.goal < 5 || data.goal > 100) {
      return [initialStudy, false];
    }
    if (data.session?.queue.some(id => !getWord(id))) delete data.session;
    const { history, review, goal, session, activityReset, studyReset } = data;
    return [{ history, review, goal, session, activityReset, studyReset }, true];
  } catch {
    return [initialStudy, false];
  }
}
