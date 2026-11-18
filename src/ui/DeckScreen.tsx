// One deck: its notes, with add, edit and delete, and the button to study it.
import { useState } from 'react';
import type { NoteWithCards } from '../db/store';
import { renderCloze } from '../lib/cloze';
import { ClozeText, PlainText } from './CardText';
import { ConfirmDialog } from './ConfirmDialog';
import { NoteEditor } from './NoteEditor';
import { href } from './route';
import { useStore } from './store-context';
import { useLoad } from './useLoad';

export function DeckScreen({ deckId }: { deckId: string }) {
  const store = useStore();
  const { data, error, reload } = useLoad(async () => {
    const [deck, notes, summaries] = await Promise.all([
      store.getDeck(deckId),
      store.listNotes(deckId),
      store.listDecks(new Date()),
    ]);
    return { deck, notes, summary: summaries.find((d) => d.id === deckId) };
  }, [store, deckId]);
  const [editor, setEditor] = useState<'new' | NoteWithCards | null>(null);
  const [deleting, setDeleting] = useState<NoteWithCards | null>(null);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.deck) return <MissingDeck />;
  const { deck, notes, summary } = data;

  return (
    <section>
      <p>
        <a href={href({ name: 'decks' })}>← Decks</a>
      </p>
      <h2>{deck.name}</h2>
      <div className="row">
        <span className="counts">
          <span className="due">{summary?.dueCount ?? 0} due</span>
          <span className="new">{summary?.newCount ?? 0} new</span>
        </span>
        <a className="button primary" href={href({ name: 'review', deckId })}>
          Study
        </a>
      </div>

      {editor === null ? (
        <button type="button" className="primary wide" onClick={() => setEditor('new')}>
          Add a note
        </button>
      ) : (
        <NoteEditor
          key={editor === 'new' ? 'new' : editor.note.id}
          deckId={deckId}
          editing={editor === 'new' ? undefined : editor}
          onCancel={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await reload();
          }}
        />
      )}

      <h3>
        {notes.length} note{notes.length === 1 ? '' : 's'}
      </h3>
      <ul className="list" aria-label="Notes">
        {notes.map((item) => (
          <li key={item.note.id} className="note-row" data-testid="note-row">
            <div className="note-text">
              {item.note.kind === 'cloze' ? (
                <ClozeText segments={renderCloze(item.note.front, 0, 'front')} />
              ) : (
                <PlainText text={item.note.front} />
              )}
              <span className="muted small">
                {item.note.kind === 'cloze' ? `Cloze, ${item.cards.length} cards` : 'Basic'}
              </span>
            </div>
            <div className="row">
              <button type="button" onClick={() => setEditor(item)} aria-label="Edit note">
                Edit
              </button>
              <button type="button" onClick={() => setDeleting(item)} aria-label="Delete note">
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deleting && (
        <ConfirmDialog
          title="Delete this note?"
          message={`Its ${deleting.cards.length} card${deleting.cards.length === 1 ? '' : 's'} will be deleted from this device.`}
          confirmLabel="Delete note"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const item = deleting;
            setDeleting(null);
            await store.deleteNote(item.note.id).catch(() => {});
            await reload();
          }}
        />
      )}
    </section>
  );
}

export function MissingDeck() {
  return (
    <section>
      <h2>Deck not found</h2>
      <p className="muted">It may have been deleted.</p>
      <a href={href({ name: 'decks' })}>← Back to your decks</a>
    </section>
  );
}
