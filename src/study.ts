import vocabulary from '../content/words.json';
import review from '../content/review.json';
import quizAlternatives from '../content/quiz-alternatives.json';
import { createQuiz, normalize } from './quiz';

export { normalize } from './quiz';

export type Word = (typeof vocabulary)[number];
export const words = vocabulary;
const quiz = createQuiz(words, quizAlternatives);
const quizRevision = 2;
const groups: Record<string, { title: string; rows: string[][]; members?: string[] }> = review;
export const allTopics = 'All topics';
const legacyWithoutNumbers = 'All except numbers';
const wordKinds = { Nouns: 'noun', Verbs: 'verb', Adjectives: 'adjective' };
export const topics = [allTopics, ...Object.keys(wordKinds),
  ...[...new Set(words.map(word => word.topic))].filter(topic => !(topic in wordKinds))];

function matchesTopic(word: Word, topic: string): boolean {
  if (topic === allTopics) return true;
  if (word.topic === 'Numbers') return topic === 'Numbers';
  const kind = wordKinds[topic as keyof typeof wordKinds];
  return kind ? word.kind === kind : word.topic === topic;
}

export const topicCounts = Object.fromEntries(topics.map(topic => [
  topic, words.filter(word => matchesTopic(word, topic)).length,
]));

export function availableWords(selection: string[]) {
  return selection.length === 0 ? words : words.filter(word => selection.some(topic => matchesTopic(word, topic)));
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
  quizRevision?: number;
  isRetry?: boolean;
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

export function relatedGroups(word: Word) {
  const base = word.forms.find(form => form.label === 'Base form')?.text;
  return Object.entries(groups).filter(([key, group]) =>
    word.groups.includes(key) || group.members?.some(member => member === word.nl || member === base));
}

export function localDay(offset = 0) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return [day.getFullYear(), day.getMonth() + 1, day.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-');
}

export function prompt(word: Word, mode: Mode) {
  if (mode === 'listen') return 'Listen and choose the meaning';
  if (mode === 'typing' || (word.kind === 'ordinal' && mode === 'choice')) return word.en;
  return word.nl;
}

export function expected(word: Word, mode: Mode) {
  return mode === 'typing' || (word.kind === 'ordinal' && mode === 'choice') ? word.nl : word.en;
}

export function isCorrectAnswer(word: Word, mode: Mode, value: string) {
  const reply = normalize(value);
  if (normalize(expected(word, mode)) === reply) return true;
  return mode === 'typing' && words.some(card =>
    normalize(card.nl) === reply && normalize(card.en) === normalize(word.en));
}

function optionsFor(id: string | undefined, mode: Mode): string[] {
  const word = getWord(id);
  if (!word || mode === 'flashcards' || mode === 'typing') return [];
  return quiz.choices(word, word.kind === 'ordinal' && mode === 'choice', mode === 'listen');
}

export function selectedTopics(session: Session): string[] {
  const selection = session.topics ?? (session.topic === allTopics ? [] : [session.topic]);
  if (!selection.includes(legacyWithoutNumbers)) return selection;
  const included = selection.filter(topic => topic !== legacyWithoutNumbers && topic !== 'Numbers');
  return included.length ? included : topics.filter(topic => topic !== allTopics && topic !== 'Numbers');
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
    topics: selection, topic: selection.length === 1 ? selection[0] : allTopics, mode,
    options: optionsFor(queue[0], mode), quizRevision, retries: {},
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
  const pendingRetries = session.queue.slice(1).filter(id => seen.has(id));
  return { ...updated, queue: [current, ...remaining, ...pendingRetries], size: seen.size + remaining.length, completed };
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
  const queue = session.queue.slice(1);
  return { ...session, queue, question: session.question === undefined ? undefined : session.question + 1,
    isRetry: session.completed?.includes(queue[0]),
    options: optionsFor(queue[0], session.mode), quizRevision, result: undefined, selected: undefined };
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

function refreshQueue(session: Session): Session {
  const queue = session.queue.filter(id => getWord(id));
  const currentRemoved = queue[0] !== session.queue[0];
  const refreshOptions = currentRemoved || (!session.result && session.quizRevision !== quizRevision);
  if (queue.length === session.queue.length && !refreshOptions) return session;
  const size = session.completed
    ? new Set([...session.completed, ...queue]).size
    : session.size;
  const updated = { ...session, queue, size };
  if (!refreshOptions) return updated;
  return { ...updated, options: optionsFor(queue[0], session.mode), quizRevision,
    isRetry: session.completed?.includes(queue[0]),
    selected: undefined, result: undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSession(value: unknown): value is Session {
  return isRecord(value) && typeof value.date === 'string' && typeof value.topic === 'string'
    && isStringList(value.queue) && isStringList(value.options)
    && isRecord(value.retries) && Object.values(value.retries).every(isCounter)
    && (value.mode === 'choice' || value.mode === 'listen' || value.mode === 'typing' || value.mode === 'flashcards')
    && (value.topics === undefined || isStringList(value.topics))
    && (value.completed === undefined || isStringList(value.completed))
    && (value.missedWords === undefined || isStringList(value.missedWords))
    && (value.result === undefined || value.result === 'correct' || value.result === 'wrong' || value.result === 'reveal')
    && (value.selected === undefined || typeof value.selected === 'string')
    && [value.question, value.size, value.target, value.quizRevision].every(item => item === undefined || isCounter(item));
}

function isReview(value: unknown): value is Review {
  return isRecord(value) && typeof value.due === 'string' && typeof value.missed === 'boolean'
    && isCounter(value.streak) && (value.updatedAt === undefined || isCounter(value.updatedAt));
}

export function restoreTab(): TabPractice | undefined {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(tabKey) ?? 'null');
    if (!isRecord(saved) || !isSession(saved.session) || saved.session.date !== localDay()) return;
    const session = refreshQueue(saved.session);
    const sameQuestion = session.queue[0] === saved.session.queue[0];
    return {
      session,
      input: sameQuestion && typeof saved.input === 'string' ? saved.input : '',
      flipped: sameQuestion && saved.flipped === true,
      studyReset: isCounter(saved.studyReset) ? saved.studyReset : undefined,
    };
  } catch {
    return;
  }
}

export function restore(): [Study, boolean] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [initialStudy, true];
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || (!isRecord(data.history) && !isRecord(data.review))) {
      return [initialStudy, false];
    }
    const history = Object.fromEntries(Object.entries(isRecord(data.history) ? data.history : {})
      .filter((entry): entry is [string, string[]] => isStringList(entry[1])));
    const review = Object.fromEntries(Object.entries(isRecord(data.review) ? data.review : {})
      .filter((entry): entry is [string, Review] => isReview(entry[1])));
    return [{
      history, review,
      goal: isCounter(data.goal) && data.goal >= 5 && data.goal <= 100 ? data.goal : initialStudy.goal,
      session: isSession(data.session) ? refreshQueue(data.session) : undefined,
      activityReset: isCounter(data.activityReset) ? data.activityReset : undefined,
      studyReset: isCounter(data.studyReset) ? data.studyReset : undefined,
    }, true];
  } catch {
    return [initialStudy, false];
  }
}
