import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import numbers from '../content/numbers.json';
import coverage from '../content/coverage.json';
import { playDutch, stopAudio } from './audio';
import {
  allTopics, answer, availableWords, changeTopics, createSession, expected, getWord, groups, localDay, mergeStudy, next,
  normalize, prompt, restore, restoreTab, roundMistakes, selectedTopics, storageKey, tabKey, topicCounts, topics, words,
} from './study';
import type { Mode, Rating, Word } from './study';

const modes: Record<Mode, string> = { choice: 'Four choices', listen: 'Listening', typing: 'Type in Dutch', flashcards: 'Flashcards' };

function Icon({ name }: { name: 'audio' | 'arrow' | 'check' }) {
  const path = {
    audio: 'M3 9v6h4l5 4V5L7 9H3zM16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10',
    arrow: 'M4 12h15m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6',
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path[name]} /></svg>;
}

function AudioButton({ text, onPlay, compact = false }: { text: string; onPlay: (text: string) => void; compact?: boolean }) {
  return <button className={compact ? 'icon compact' : 'icon'} onClick={() => onPlay(text)} aria-label="Play pronunciation" title="Play pronunciation"><Icon name="audio" /></button>;
}

function Feedback({ word, onPlay, expanded = false }: { word: Word; onPlay: (text: string) => void; expanded?: boolean }) {
  return <div className="feedback-detail">
    {!!word.forms.length && <dl className="forms">
      {word.kind === 'noun' && word.forms.some(form => form.label === 'Plural') && <div><dt>Singular</dt><dd><span lang="nl-BE">{word.nl}</span><AudioButton text={word.nl} onPlay={onPlay} compact /></dd></div>}
      {word.forms.map(form => <div key={form.label}><dt>{form.label}</dt><dd><span lang="nl-BE">{form.text}</span><AudioButton text={form.text} onPlay={onPlay} compact /></dd></div>)}
    </dl>}
    {word.groups.map(key => <details key={key} open={expanded || undefined}>
      <summary>{groups[key].title}</summary>
      <table><tbody>{groups[key].rows.map(([use, dutch, english]) => <tr key={dutch}>
        {use && <td>{use}</td>}<th scope="row" lang="nl-BE">{dutch}</th><td>{english}</td>
        <td><AudioButton text={dutch} onPlay={onPlay} compact /></td>
      </tr>)}</tbody></table>
    </details>)}
    {word.forms.some(form => form.label === 'Ordinal') && <details>
      <summary>Number patterns</summary>
      <p className="small">1–19 usually take <b>-de</b>. Remember <span lang="nl-BE">eerste, derde, achtste</span>. From 20 onward, look for <b>-ste</b>.</p>
      <table><thead><tr><th>Number</th><th>Cardinal</th><th>Ordinal</th></tr></thead>
        <tbody>{numbers.map(([number, cardinal, ordinal]) => <tr key={number}><th scope="row">{number}</th>
          <td lang="nl-BE">{cardinal} <AudioButton text={String(cardinal)} onPlay={onPlay} compact /></td><td lang="nl-BE">{ordinal} <AudioButton text={String(ordinal)} onPlay={onPlay} compact /></td></tr>)}</tbody></table>
    </details>}
  </div>;
}

function Activity({ history, onClear }: { history: Record<string, string[]>; onClear: () => void }) {
  const [date, select] = useState(localDay());
  const dates = Array.from({ length: 84 }, (_, i) => localDay(i - 83));
  const selectedCount = history[date]?.length ?? 0;
  const studyDays = Object.values(history).filter(day => day.length > 0).length;
  return <section className="surface">
    <h1>Activity</h1>
    <p className="small">{studyDays} {studyDays === 1 ? 'study day' : 'study days'}</p>
    <div className="calendar" aria-label="Daily practice over the last 12 weeks">
      {dates.map(day => {
        const count = history[day]?.length ?? 0;
        const level = count >= 30 ? 3 : count >= 10 ? 2 : count > 0 ? 1 : 0;
        return <button key={day} className={`day level-${level}`} aria-label={`${day}, ${count} words`}
          aria-pressed={date === day} title={`${day} · ${count} words`} onClick={() => select(day)} />;
      })}
    </div>
    <p aria-live="polite">{date} · {selectedCount} {selectedCount === 1 ? 'word' : 'words'}</p>
    <button className="text-button" onClick={onClear} disabled={!studyDays}>Clear activity</button>
  </section>;
}

function Browse({ onPlay }: { onPlay: (text: string) => void }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  const results = words.filter(word => normalize([word.nl, word.en, ...word.forms.map(form => form.text)].join(' ')).includes(normalize(query)));
  return <section className="surface">
    <h1>Words</h1>
    <input className="search" aria-label="Search Dutch or English" placeholder="Search Dutch or English" value={query} onChange={event => { setQuery(event.target.value); setLimit(60); }} />
    <p className="small">{results.length} entries</p>
    <div className="word-list">{results.slice(0,limit).map(word => <article key={word.id}>
      <div className="word-row"><div><b lang="nl-BE">{word.nl}</b><p>{word.en}</p></div><AudioButton text={word.nl} onPlay={onPlay} /></div>
      <details><summary>Word details</summary><Feedback word={word} onPlay={onPlay} />
        <p className="small">{word.source.file}, {word.source.location}</p>
        {'dictionary' in word && typeof word.dictionary === 'string' &&
          <p className="small"><a href={'https://en.wiktionary.org/wiki/' + encodeURIComponent(word.dictionary) + '#Dutch'}>Dictionary source</a></p>}
      </details>
    </article>)}</div>
    {results.length > limit && <button className="text-button" onClick={() => setLimit(current => current + 60)}>Load more</button>}
  </section>;
}

function TopicPicker({ selection, onChange, disabled }: {
  selection: string[];
  onChange: (selection: string[]) => void;
  disabled?: boolean;
}) {
  return <fieldset className="topic-picker" disabled={disabled}>
    <legend>Topics</legend>
    <div className="topic-options">
      {topics.map(topic => <label key={topic} className="topic-option">
        <input type="checkbox" checked={topic === allTopics ? selection.length === 0 : selection.includes(topic)}
          onChange={event => {
            if (topic === allTopics) { onChange([]); return; }
            if (!event.target.checked) { onChange(selection.filter(item => item !== topic)); return; }
            onChange([...selection, topic]);
          }} />
        {topic} <span className="topic-count">{topicCounts[topic]}</span>
      </label>)}
    </div>
  </fieldset>;
}

function RoundReview({ missedWords }: { missedWords: string[] }) {
  const topics = roundMistakes(missedWords);
  if (!topics.length) return <p className="small">No incorrect answers this round.</p>;

  return <section className="round-review" aria-labelledby="round-review-title">
    <h2 id="round-review-title">Most missed topics</h2>
    <dl>{topics.map(([topic, count]) => <div key={topic}>
      <dt>{topic}</dt>
      <dd>{count} {count === 1 ? 'word' : 'words'}</dd>
    </div>)}</dl>
  </section>;
}

function readView() {
  const view = location.hash.slice(1);
  return ['words', 'activity', 'settings'].includes(view) ? view : 'practice';
}

export default function App() {
  const [[initial, storageOk]] = useState(restore);
  const [tab] = useState(() => {
    const saved = restoreTab();
    if (saved && (saved.studyReset ?? 0) === (initial.studyReset ?? 0)) return saved;
    const legacy = initial.session;
    if (legacy?.date === localDay() && legacy.queue.length && !legacy.first
        && !initial.studyReset && (legacy.result || initial.history[legacy.date]?.length)) {
      return { session: { ...legacy, first: legacy.queue[0] }, input: '', flipped: false };
    }
  });
  const [study, setStudy] = useState(() => ({
    ...initial, session: tab?.session ?? initial.session ?? createSession(initial),
  }));
  const [view, setView] = useState(readView);
  const [input, setInput] = useState(tab?.input ?? '');
  const [flipped, flip] = useState(tab?.flipped ?? false);
  const [started, setStarted] = useState(!!tab);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [storageError, setStorageError] = useState(!storageOk);
  const audioTicket = useRef(0);
  const session = study.session;
  const word = getWord(session.queue[0]);
  const practiced = study.history[localDay()]?.length ?? 0;
  const remaining = words.filter(entry => !study.review[entry.id]).length;
  const selection = selectedTopics(session);
  const nextSize = Math.min(study.goal, availableWords(selection).length);
  const shortRoundHint = nextSize < study.goal && <p className="small" role="status">
    Your selected topics have {nextSize} {nextSize === 1 ? 'word' : 'words'}. Check more topics below for a {study.goal}-word round.
  </p>;

  useEffect(() => {
    try {
      const [saved] = restore();
      if ((saved.activityReset ?? 0) > (study.activityReset ?? 0)
          || (saved.studyReset ?? 0) > (study.studyReset ?? 0)) return;
      localStorage.setItem(storageKey, JSON.stringify(mergeStudy(study, saved)));
    } catch { setStorageError(true); }
  }, [study]);

  useEffect(() => {
    try {
      if (started) {
        sessionStorage.setItem(tabKey, JSON.stringify({ session, input, flipped, studyReset: study.studyReset }));
      } else {
        sessionStorage.removeItem(tabKey);
      }
    } catch { setStorageError(true); }
  }, [started, session, input, flipped, study.studyReset]);

  useEffect(() => {
    function syncResets(event: StorageEvent) {
      if (event.key !== storageKey) return;
      const [saved, valid] = restore();
      if (!valid) return;
      const clearedActivity = (saved.activityReset ?? 0) > (study.activityReset ?? 0);
      const clearedStudy = (saved.studyReset ?? 0) > (study.studyReset ?? 0);
      if (!clearedActivity && !clearedStudy) return;
      if (clearedStudy) {
        audioTicket.current++;
        stopAudio();
        setStarted(false);
        setInput('');
        flip(false);
        setAudioError('');
      }
      setStudy(current => {
        const history = clearedActivity ? saved.history : current.history;
        const base = { ...current, history, activityReset: clearedActivity ? saved.activityReset : current.activityReset };
        if (!clearedStudy) return base;
        const reset = { ...base, review: saved.review, studyReset: saved.studyReset, session: undefined };
        return { ...reset, session: createSession(reset, selectedTopics(current.session), current.session.mode) };
      });
    }
    window.addEventListener('storage', syncResets);
    return () => window.removeEventListener('storage', syncResets);
  }, [study.activityReset, study.studyReset]);

  useEffect(() => {
    const change = () => {
      audioTicket.current++;
      stopAudio();
      setAudioError('');
      setView(readView());
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  function play(text: string) {
    const ticket = ++audioTicket.current;
    setAudioError('');
    void playDutch(text).catch(() => {
      if (ticket === audioTicket.current) setAudioError('Audio could not play. Tap the speaker to try again.');
    });
  }

  function advance() {
    audioTicket.current++;
    stopAudio();
    setInput('');
    flip(false);
    setAudioError('');
    setStudy(current => current.session.result
      ? { ...current, session: next(current.session) }
      : current);
  }

  function newSession(nextTopics = selection, mode = session.mode) {
    audioTicket.current++;
    stopAudio();
    setAudioError('');
    setInput('');
    flip(false);
    setStudy(current => ({ ...current, session: createSession(current, nextTopics, mode) }));
  }

  function updateTopics(nextTopics: string[]) {
    setStudy(current => ({
      ...current,
      session: started
        ? changeTopics(current, current.session, nextTopics)
        : createSession(current, nextTopics, current.session.mode),
    }));
  }

  function clearActivity() {
    if (!window.confirm('Clear the activity calendar and daily counts? Word progress will be kept.')) return;
    setStudy(current => ({
      ...current, history: {}, activityReset: Math.max(Date.now(), (current.activityReset ?? 0) + 1),
    }));
  }

  function clearStudyHistory() {
    if (!window.confirm('Clear word progress, reviews and the current round? Activity will be kept.')) return;
    audioTicket.current++;
    stopAudio();
    setStarted(false);
    setInput('');
    flip(false);
    setAudioError('');
    setStudy(current => {
      const reset = { ...current, review: {}, studyReset: Math.max(Date.now(), (current.studyReset ?? 0) + 1), session: undefined };
      return { ...reset, session: createSession(reset, selectedTopics(current.session), current.session.mode) };
    });
  }

  function submit(value: string) {
    if (!word) return;
    const correct = normalize(value) === normalize(expected(word, session.mode));
    setStudy(current => ({ ...current, ...answer(current, current.session, correct ? 'correct' : 'wrong', value) }));
  }

  function rate(grade: Rating) {
    setStudy(current => ({ ...current, ...answer(current, current.session, grade) }));
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!started || view !== 'practice' || session.result || event.repeat || event.altKey || event.ctrlKey || event.metaKey
          || (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'BUTTON', 'SUMMARY', 'A'].includes(event.target.tagName))) return;
      const option = session.options[Number(event.key) - 1];
      if (option && /^[1-4]$/.test(event.key)) { event.preventDefault(); submit(option); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const pendingCoverage = (coverage.audit['check-gloss'] ?? 0) + (coverage.audit['check-source'] ?? 0);
  const navigation = [['practice','Practice'], ['words','Words'], ['activity','Activity'], ['settings','Settings']];
  let content: ReactNode;
  if (view === 'words') content = <Browse onPlay={play} />;
  else if (view === 'activity') content = <Activity history={study.history} onClear={clearActivity} />;
  else if (view === 'settings') content = <section className="surface settings">
    <h1>Settings</h1>
    <label>Mode<select value={session.mode} disabled={started && !!session.result} onChange={event => newSession(selection, event.target.value as Mode)}>
      {Object.entries(modes).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Daily goal<select value={study.goal} onChange={event => {
      const goal = Number(event.target.value);
      setStudy(current => ({ ...current, goal }));
    }}>{[10,20,30,40,50].map(goal => <option key={goal}>{goal}</option>)}</select></label>
    <TopicPicker selection={selection} onChange={updateTopics} />
    <button className="text-button" onClick={clearStudyHistory}>Clear study history</button>
    <details><summary>Course coverage</summary><p>{words.length} study entries. The source index records {coverage.sourceWordCandidates.toLocaleString('en')} Dutch candidates and expressions across {coverage.pdfPages.toLocaleString('en')} PDF pages. We update the deck as new course materials are added.</p>
      {pendingCoverage > 0 && <p>{pendingCoverage.toLocaleString('en')} observations await a source or meaning check.</p>}
      {(coverage.audit['unconfirmed-ocr'] ?? 0) > 0 && <p>{coverage.audit['unconfirmed-ocr']} OCR-only readings lacked source confirmation and were left out of the deck.</p>}
      <p className="small"><a href="https://kaikki.org/dictionary/Dutch/">Dictionary data from English Wiktionary via Kaikki</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></p>
    </details>
  </section>;
  else if (!started) content = <section className="surface start-screen">
    <button className="primary" disabled={!nextSize} onClick={() => {
      newSession();
      setStarted(true);
    }}>Start <Icon name="arrow" /></button>
    {shortRoundHint}
  </section>;
  else if (!word) content = <section className="surface round-complete">
    <h1>Round complete</h1>
    {session.completed && <p>{session.completed.length} {session.completed.length === 1 ? 'word' : 'words'} this round</p>}
    {session.missedWords && <RoundReview missedWords={session.missedWords} />}
    {shortRoundHint}
    {nextSize > 0 && <button className="primary" onClick={() => newSession()}>Start next {nextSize} <Icon name="arrow" /></button>}
  </section>;
  else {
    const dutchPrompt = session.mode !== 'listen' && session.mode !== 'typing' && !(word.kind === 'ordinal' && session.mode === 'choice');
    content = <section className="surface practice" aria-label="Vocabulary question">
      <div className="question-top"><span>{session.question ? 'Question ' + session.question + ' · ' : ''}{word.topic}{word.kind === 'ordinal' && session.mode === 'choice' ? ' · Ordinal' : ''}</span>
        <AudioButton text={word.nl} onPlay={play} />
      </div>
      <h1 key={word.id} lang={dutchPrompt ? 'nl-BE' : 'en'}>{prompt(word, session.mode)}</h1>
      {session.options.length > 0 && <ol className="choices">
        {session.options.map((option,index) => {
          const right = !!session.result && option === expected(word, session.mode);
          const wrong = session.result === 'wrong' && option === session.selected;
          return <li key={option}><button disabled={!!session.result} onClick={() => submit(option)}
            className={right ? 'right' : wrong ? 'wrong' : ''}>
            <span className="key">{index + 1}</span><span>{option}</span>{right && <Icon name="check" />}
          </button></li>;
        })}
      </ol>}
      {session.mode === 'typing' && !session.result && <form className="answer-form" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(input); }}>
        <input aria-label="Your Dutch answer" autoComplete="off" value={input} onChange={event => setInput(event.target.value)} placeholder="Type the Dutch answer" />
        <button className="primary" disabled={!input.trim()}>Check</button>
      </form>}
      {!session.result && session.mode === 'flashcards' && flipped && <div className="flashcard-answer">
        <p>{word.en}</p>
        <div className="answer-form"><button className="primary" onClick={() => rate('wrong')}>Review again</button>
          <button className="primary" onClick={() => rate('correct')}>I knew it</button></div>
      </div>}
      {!session.result && !flipped && <button className="text-button" onClick={() => {
        if (session.mode === 'flashcards') flip(true);
        else rate('reveal');
      }}>Show answer</button>}
      {session.result && <div className="result">
        <p role="status" className={session.result === 'wrong' ? 'wrong-text' : ''}>
          {session.result === 'correct' ? 'Correct' : session.result === 'wrong' ? 'Answer' : 'Revealed'} · <span lang="nl-BE">{word.nl}</span> · {word.en}
        </p>
        <Feedback word={word} onPlay={play} expanded={session.result === 'correct'} />
        <button className="primary next" onClick={advance}>Next <Icon name="arrow" /></button>
      </div>}
    </section>;
  }

  return <div className="app">
    <header><a className="brand" href="#practice"><span aria-hidden="true">D</span> Dutch Vocabulary</a>
      <nav aria-label="Main navigation">{navigation.map(([key,label]) => <a key={key} href={'#' + key}
        aria-current={view === key ? 'page' : undefined}>{label}</a>)}</nav>
    </header>
    <main>
      {view === 'practice' && <div className="session-bar">
        {started && word && <button className="text-button topic-toggle" aria-expanded={topicsOpen}
          onClick={() => setTopicsOpen(open => !open)}>Topics</button>}
        <a href="#activity" className="daily"><progress value={Math.min(practiced, study.goal)} max={study.goal} aria-label="Daily goal" />
          <span>Today {practiced}{practiced <= study.goal ? ' / ' + study.goal : ''}</span></a>
      </div>}
      {view === 'practice' && <p className="small round-progress">
        {started && session.size ? `Round ${session.completed?.length ?? 0} / ${session.size} · ` : ''}
        {remaining} of {words.length} words left
      </p>}
      {view === 'practice' && started && word && topicsOpen &&
        <TopicPicker selection={selection} onChange={updateTopics} />}
      {content}
      {view === 'practice' && (!started || !word) &&
        <TopicPicker selection={selection} onChange={updateTopics} />}
      {audioError && <p role="status" className="small">{audioError}</p>}
      {storageError && <p role="status" className="small">Saved progress could not be restored or saved in this browser.</p>}
    </main>
  </div>;
}
