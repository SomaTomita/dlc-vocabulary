import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import numbers from '../content/numbers.json';
import { playDutch, stopAudio } from './audio';
import {
  answer, createSession, expected, getWord, groups, localDay, next,
  normalize, prompt, restore, storageKey, topics, words,
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
      {word.kind === 'noun' && <div><dt>Singular</dt><dd><span lang="nl-BE">{word.nl}</span><AudioButton text={word.nl} onPlay={onPlay} compact /></dd></div>}
      {word.forms.map(form => <div key={form.label}><dt>{form.label}</dt><dd><span lang="nl-BE">{form.text}</span><AudioButton text={form.text} onPlay={onPlay} compact /></dd></div>)}
    </dl>}
    {word.groups.map(key => <details key={key} open={expanded || undefined}>
      <summary>{groups[key].title}</summary>
      <table><tbody>{groups[key].rows.map(([use, dutch, english]) => <tr key={dutch}>
        {use && <td>{use}</td>}<th scope="row" lang="nl-BE">{dutch}</th><td>{english}</td>
        <td><AudioButton text={dutch} onPlay={onPlay} compact /></td>
      </tr>)}</tbody></table>
    </details>)}
    {word.topic === 'Numbers' && <details>
      <summary>Number patterns</summary>
      <p className="small">1–19 usually take <b>-de</b>. Remember <span lang="nl-BE">eerste, derde, achtste</span>. From 20 onward, look for <b>-ste</b>.</p>
      <table><thead><tr><th>Number</th><th>Cardinal</th><th>Ordinal</th></tr></thead>
        <tbody>{numbers.map(([number, cardinal, ordinal]) => <tr key={number}><th scope="row">{number}</th>
          <td lang="nl-BE">{cardinal} <AudioButton text={String(cardinal)} onPlay={onPlay} compact /></td><td lang="nl-BE">{ordinal} <AudioButton text={String(ordinal)} onPlay={onPlay} compact /></td></tr>)}</tbody></table>
    </details>}
  </div>;
}

function Activity({ history }: { history: Record<string, string[]> }) {
  const [date, select] = useState(localDay());
  const dates = Array.from({ length: 84 }, (_, i) => localDay(i - 83));
  const selectedCount = history[date]?.length ?? 0;
  return <section className="surface">
    <h1>Activity</h1>
    <div className="calendar" aria-label="Daily practice over the last 12 weeks">
      {dates.map(day => {
        const count = history[day]?.length ?? 0;
        const level = count >= 30 ? 3 : count >= 10 ? 2 : count > 0 ? 1 : 0;
        return <button key={day} className={`day level-${level}`} aria-label={`${day}, ${count} words`}
          aria-pressed={date === day} title={`${day} · ${count} words`} onClick={() => select(day)} />;
      })}
    </div>
    <p aria-live="polite">{date} · {selectedCount} {selectedCount === 1 ? 'word' : 'words'}</p>
  </section>;
}

function Browse({ onPlay }: { onPlay: (text: string) => void }) {
  const [query, setQuery] = useState('');
  const results = words.filter(word => normalize([word.nl, word.en, ...word.forms.map(form => form.text)].join(' ')).includes(normalize(query)));
  return <section className="surface">
    <h1>Words</h1>
    <input className="search" aria-label="Search Dutch or English" placeholder="Search Dutch or English" value={query} onChange={event => setQuery(event.target.value)} />
    <p className="small">{results.length} entries</p>
    <div className="word-list">{results.map(word => <article key={word.id}>
      <div className="word-row"><div><b lang="nl-BE">{word.nl}</b><p>{word.en}</p></div><AudioButton text={word.nl} onPlay={onPlay} /></div>
      <details><summary>Word details</summary><Feedback word={word} onPlay={onPlay} />
        <p className="small">{word.source.file}, {word.source.location}</p>
      </details>
    </article>)}</div>
  </section>;
}

function readView() {
  const view = location.hash.slice(1);
  return ['words', 'activity', 'settings'].includes(view) ? view : 'practice';
}

export default function App() {
  const [[initial, storageOk]] = useState(restore);
  const [study, setStudy] = useState(() => ({ ...initial, session: initial.session ?? createSession(initial) }));
  const [view, setView] = useState(readView);
  const [input, setInput] = useState('');
  const [flipped, flip] = useState(false);
  const [frozen, freeze] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [storageError, setStorageError] = useState(!storageOk);
  const [playing, setPlaying] = useState(false);
  const audioTicket = useRef(0);
  const session = study.session;
  const word = getWord(session.queue[0]);
  const practiced = study.history[localDay()]?.length ?? 0;

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(study)); }
    catch { setStorageError(true); }
  }, [study]);

  useEffect(() => {
    const change = () => {
      audioTicket.current++;
      stopAudio();
      setPlaying(false);
      setAudioError('');
      setView(readView());
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  function play(text: string) {
    const ticket = ++audioTicket.current;
    setPlaying(true);
    setAudioError('');
    void playDutch(text).catch(() => {
      if (ticket === audioTicket.current) setAudioError('Audio could not play. Tap the speaker to try again.');
    }).finally(() => {
      if (ticket === audioTicket.current) setPlaying(false);
    });
  }

  function advance() {
    audioTicket.current++;
    stopAudio();
    setInput('');
    flip(false);
    setPlaying(false);
    setAudioError('');
    freeze(false);
    setStudy(current => ({ ...current, session: next(current.session) }));
  }

  function newSession(topic = session.topic, mode = session.mode) {
    audioTicket.current++;
    stopAudio();
    setPlaying(false);
    setAudioError('');
    setInput('');
    flip(false);
    freeze(false);
    setStudy(current => ({ ...current, session: createSession(current, topic, mode) }));
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
    if (view !== 'practice' || session.result !== 'correct' || frozen || playing || !study.auto) return;
    const timer = window.setTimeout(advance, 1800);
    return () => window.clearTimeout(timer);
  }, [view, session, frozen, playing, study.auto]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (view !== 'practice' || event.repeat || event.altKey || event.ctrlKey || event.metaKey
          || (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'BUTTON', 'SUMMARY', 'A'].includes(event.target.tagName))) return;
      if (event.key === 'Enter' && session.result) { event.preventDefault(); advance(); }
      const option = session.options[Number(event.key) - 1];
      if (!session.result && option && /^[1-4]$/.test(event.key)) { event.preventDefault(); submit(option); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const navigation = [['practice','Practice'], ['words','Words'], ['activity','Activity'], ['settings','Settings']];
  let content: ReactNode;
  if (view === 'words') content = <Browse onPlay={play} />;
  else if (view === 'activity') content = <Activity history={study.history} />;
  else if (view === 'settings') content = <section className="surface settings">
    <h1>Settings</h1>
    <label>Mode<select value={session.mode} onChange={event => newSession(session.topic, event.target.value as Mode)}>
      {Object.entries(modes).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Daily goal<select value={study.goal} onChange={event => {
      const goal = Number(event.target.value);
      setStudy(current => ({ ...current, goal }));
    }}>{[10,20,30,40,50].map(goal => <option key={goal}>{goal}</option>)}</select></label>
    <label>Auto-advance after correct answers<input type="checkbox" checked={study.auto} onChange={event => {
      const auto = event.target.checked;
      setStudy(current => ({ ...current, auto }));
    }} /></label>
    <details><summary>Course coverage</summary><p>{words.length} study entries in the initial release. The source inventory has 2,191 Dutch candidates and selected expressions. Full vocabulary review is in progress.</p></details>
  </section>;
  else if (!word) content = <section className="surface"><h1>Round complete</h1><button className="primary" onClick={() => newSession()}>Keep practising <Icon name="arrow" /></button></section>;
  else {
    const dutchPrompt = session.mode !== 'listen' && session.mode !== 'typing' && !(word.kind === 'ordinal' && session.mode === 'choice');
    content = <section className="surface practice" aria-label="Vocabulary question">
      <div className="question-top"><span>{word.topic}{word.kind === 'ordinal' && session.mode === 'choice' ? ' · Ordinal' : ''}</span>
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
      {session.result && <div className="result" onPointerDown={() => freeze(true)} onFocusCapture={() => freeze(true)}>
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
        <label><span className="sr-only">Topic</span><select value={session.topic} onChange={event => newSession(event.target.value)}>
          {topics.map(topic => <option key={topic}>{topic}</option>)}</select></label>
        <a href="#activity" className="daily"><progress value={Math.min(practiced, study.goal)} max={study.goal} aria-label="Daily goal" />
          <span>{practiced} / {study.goal}</span></a>
      </div>}
      {content}
      {audioError && <p role="status" className="small">{audioError}</p>}
      {storageError && <p role="status" className="small">Saved progress could not be restored or saved in this browser.</p>}
    </main>
  </div>;
}
