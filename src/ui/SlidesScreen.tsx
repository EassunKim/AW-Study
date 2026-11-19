// A slide deck in the viewer (#25), optionally opened at a section's slides with the range marked,
// with its notes and highlights (#56).
// Loaded on demand (with PDF.js), so the first screen doesn't wait for it.
import { useState } from 'react';
import { slidesLabel } from './classes';
import { DeckSlides } from './DeckSlides';
import { href } from './route';
import { useStore } from './store-context';
import { useLoad } from './useLoad';

export default function SlidesScreen({ courseId, deckId, first, last }: { courseId: string; deckId: string; first?: number; last?: number }) {
  const store = useStore();
  const { data, error } = useLoad(async () => {
    const [course, decks] = await Promise.all([store.getCourse(courseId), store.listSlideDecks(courseId)]);
    const deck = decks.find((d) => d.id === deckId);
    return { course, deck, pdf: deck ? await store.getSlideDeckFile(deck.id) : null };
  }, [store, courseId, deckId]);
  const [page, setPage] = useState(first ?? 1);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Opening the slides…</p>;
  const { course, deck, pdf } = data;
  if (!course || !deck || !pdf) {
    return (
      <section>
        <h2>Slides not found</h2>
        <p className="muted">They may have been deleted.</p>
        <a href={course ? href({ name: 'class', courseId }) : href({ name: 'classes' })}>← Back</a>
      </section>
    );
  }
  const range = first && last ? { first, last } : undefined;

  return (
    <section className="slides-screen">
      <p>
        <a href={href({ name: 'class', courseId })}>← {course.name}</a>
      </p>
      <h2>
        {deck.title}
        {range && <span className="muted small"> · {slidesLabel(range.first, range.last)}</span>}
      </h2>
      <div className="slides-frame">
        <DeckSlides deckId={deck.id} pdf={pdf} page={page} range={range} onPageChange={setPage} />
      </div>
    </section>
  );
}
