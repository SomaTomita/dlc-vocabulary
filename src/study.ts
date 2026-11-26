import vocabulary from '../content/words.json';
import review from '../content/review.json';

export type Word = (typeof vocabulary)[number];
export const words = vocabulary;
export const groups: Record<string, { title: string; rows: string[][] }> = review;
export const topics = ['All topics', ...new Set(words.map(word => word.topic))];

export type Mode = 'choice' | 'listen' | 'typing' | 'flashcards';
export type Rating = 'correct' | 'wrong' | 'reveal';
export type Review = { due: string; streak: number; missed: boolean };
export type Session = {
  date: string;
  queue: string[];
  first?: string;
  question?: number;
  size?: number;
  completed?: string[];
  topic: string;
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
};

export const storageKey = 'dlc-vocabulary.study.v1';
export const tabKey = 'dlc-vocabulary.practice.v1';
export type TabPractice = { session: Session; input: string; flipped: boolean };
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

export function createSession(study: Study, topic = 'All topics', mode: Mode = 'choice'): Session {
  const date = localDay();
  const practiced = new Set(study.history[date]);
  const pool = words.filter(word => topic === 'All topics' || word.topic === topic);
  const previousFirst = study.session?.first ?? study.session?.queue[0];
  const queue = pool.map(word => {
    const review = study.review[word.id];
    // Misses get a small edge without fixing the order of the next round.
    const weight = review?.missed ? 1.6 : !review || review.due <= date ? 1.2 : 1;
    return {
      id: word.id, priority: -Math.log(1 - Math.random()) / weight,
      alreadyPractised: practiced.has(word.id) && !review?.missed,
    };
  }).sort((a, b) => Number(a.alreadyPractised) - Number(b.alreadyPractised) || a.priority - b.priority)
    .slice(0, study.goal)
    .map(item => item.id);
  if (queue.length > 1 && queue[0] === previousFirst) {
    [queue[0], queue[1]] = [queue[1], queue[0]];
  }
  return {
    date, queue, first: queue[0], question: 1, size: queue.length, completed: [],
    topic, mode, options: optionsFor(queue[0], mode), retries: {},
  };
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
    },
    review: { ...study.review, [id]: { due: localDay(interval), streak, missed: missed || alreadyMissed } },
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
    const { history, review, goal, session } = data;
    return [{ history, review, goal, session }, true];
  } catch {
    return [initialStudy, false];
  }
}
