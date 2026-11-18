// Studying a deck: the front, "Show answer" (Space), then Again / Hard / Good / Easy (keys 1-4)
// with when each would bring the card back. The queue is rebuilt after every answer (buildQueue is
// only right for the moment it's called). The time from showing a card to answering is recorded
// for milestone 4's pacing.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderCloze } from '../lib/cloze';
import { previewIntervals } from '../lib/scheduler';
import type { Card, IntervalPreview, Note, Rating } from '../types/study';
import { ClozeText, PlainText } from './CardText';
import { MissingDeck } from './DeckScreen';
import { href } from './route';
import { queueOptions } from './settings';
import { useStore } from './store-context';
import { messageOf } from './useLoad';

const BUTTONS: { rating: Rating; label: string; key: string }[] = [
  { rating: 1, label: 'Again', key: '1' },
  { rating: 2, label: 'Hard', key: '2' },
  { rating: 3, label: 'Good', key: '3' },
  { rating: 4, label: 'Easy', key: '4' },
];

type Shown = { card: Card; note: Note; left: number };

export function ReviewScreen({ deckId }: { deckId: string }) {
  const store = useStore();
  const [deckName, setDeckName] = useState<string | null | undefined>(undefined);
  const [shown, setShown] = useState<Shown | null | undefined>(undefined); // null = nothing left
  const [revealed, setRevealed] = useState(false);
  const [preview, setPreview] = useState<IntervalPreview | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const shownAt = useRef(0);
  const busy = useRef(false);

  const next = useCallback(async () => {
    const ids = await store.studyQueue(queueOptions(deckId, new Date()));
    const first = ids[0] ? await store.getCard(ids[0]) : null;
    setRevealed(false);
    setPreview(null);
    setShown(first ? { ...first, left: ids.length } : null);
    shownAt.current = performance.now();
  }, [store, deckId]);

  useEffect(() => {
    void store.getDeck(deckId).then((deck) => setDeckName(deck?.name ?? null));
    next().catch((err: unknown) => setProblem(messageOf(err)));
  }, [store, deckId, next]);

  const reveal = useCallback(() => {
    if (!shown || revealed) return;
    setPreview(previewIntervals(shown.card.state, new Date()));
    setRevealed(true);
  }, [shown, revealed]);

  const grade = useCallback(
    async (rating: Rating) => {
      if (!shown || !revealed || busy.current) return;
      busy.current = true;
      try {
        await store.answer(shown.card.id, rating, performance.now() - shownAt.current, new Date());
        setReviewed((n) => n + 1);
        await next();
      } catch (err) {
        setProblem(messageOf(err));
      } finally {
        busy.current = false;
      }
    },
    [store, shown, revealed, next],
  );

  // Keys: one listener for the screen's whole life, reading the current card through a ref. The
  // ref is updated in a layout effect, which runs right after React draws a new card and before
  // the browser handles the next key. (A listener re-added in a plain useEffect left a gap after
  // each new card in which a key reached the old card's handler and was lost: 5 of 6 WebKit runs.)
  const keys = useRef({ revealed, reveal, grade });
  useLayoutEffect(() => {
    keys.current = { revealed, reveal, grade };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      const { revealed, reveal, grade } = keys.current;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        reveal();
        return;
      }
      const button = BUTTONS.find((b) => b.key === e.key);
      if (revealed && button) {
        e.preventDefault();
        void grade(button.rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (deckName === null) return <MissingDeck />;
  if (shown === undefined || deckName === undefined) return <p className="muted">Loading…</p>;

  const back = (
    <p>
      <a href={href({ name: 'deck', deckId })}>← {deckName}</a>
    </p>
  );

  if (shown === null) {
    return (
      <section className="done" data-testid="review-done">
        {back}
        <h2>Done for now</h2>
        <p>
          {reviewed === 0
            ? 'Nothing is due in this deck right now.'
            : `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}. Nothing else is due right now.`}
        </p>
        <p className="muted">Cards you just learned come back in a few minutes; the rest are scheduled for later days.</p>
        <a className="button primary" href={href({ name: 'deck', deckId })}>
          Back to the deck
        </a>
      </section>
    );
  }

  const { card, note, left } = shown;
  return (
    <section className="review">
      {back}
      <p className="muted small" data-testid="review-left">
        {left} to go
      </p>
      <div className="card" data-testid="review-card" data-phase={card.state.phase}>
        {note.kind === 'cloze' ? (
          <ClozeText segments={renderCloze(note.front, card.ordinal, revealed ? 'back' : 'front')} />
        ) : (
          <PlainText text={note.front} />
        )}
        {revealed && (note.kind === 'basic' || note.back.trim()) && (
          <>
            <hr />
            <PlainText text={note.back} className="answer" />
          </>
        )}
      </div>
      {problem && <p className="error">{problem}</p>}
      {/* Both rows keep the same height, so the buttons don't jump under the thumb */}
      <div className="answer-bar">
        {!revealed ? (
          <button type="button" className="primary wide" onClick={reveal}>
            Show answer <kbd>Space</kbd>
          </button>
        ) : (
          <div className="grades" role="group" aria-label="How well did you remember?">
            {BUTTONS.map(({ rating, label, key }) => (
              <button key={rating} type="button" className={`grade grade-${rating}`} onClick={() => void grade(rating)}>
                <span className="grade-label">{label}</span>
                <span className="grade-when" data-testid={`when-${rating}`}>
                  {preview?.[rating].label}
                </span>
                <kbd>{key}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
