// The first screen: your decks with their due and new counts; make, rename and delete decks.
import { useState, type FormEvent } from 'react';
import { DECK_NAME_MAX, type DeckSummary } from '../db/store';
import { ConfirmDialog } from './ConfirmDialog';
import { href } from './route';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

export function DecksScreen() {
  const store = useStore();
  const { data: decks, error, reload } = useLoad(() => store.listDecks(new Date()), [store]);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeckSummary | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await store.createDeck(name);
      setName('');
      setProblem(null);
      await reload();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };

  return (
    <section>
      <h2>Decks</h2>
      {error && <p className="error">{error}</p>}
      {decks === undefined ? (
        <p className="muted">Loading…</p>
      ) : decks.length === 0 ? (
        <p className="muted">No decks yet. Make one for each course or lecture series.</p>
      ) : (
        <ul className="list" aria-label="Decks">
          {decks.map((deck) =>
            renaming === deck.id ? (
              <li key={deck.id}>
                <RenameForm
                  deck={deck}
                  onDone={async () => {
                    setRenaming(null);
                    await reload();
                  }}
                />
              </li>
            ) : (
              <li key={deck.id} className="deck-row" data-testid="deck-row">
                <a className="deck-link" href={href({ name: 'deck', deckId: deck.id })}>
                  <span className="deck-name">{deck.name}</span>
                  <span className="counts">
                    <span className="due" title="Due now">
                      {deck.dueCount} due
                    </span>
                    <span className="new" title="New cards">
                      {deck.newCount} new
                    </span>
                  </span>
                </a>
                <div className="row">
                  <a className="button primary" href={href({ name: 'review', deckId: deck.id })}>
                    Study
                  </a>
                  <button type="button" onClick={() => setRenaming(deck.id)} aria-label={`Rename ${deck.name}`}>
                    Rename
                  </button>
                  <button type="button" onClick={() => setDeleting(deck)} aria-label={`Delete ${deck.name}`}>
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <form className="stack" onSubmit={create}>
        <label htmlFor="new-deck">New deck</label>
        <div className="row">
          <input
            id="new-deck"
            value={name}
            maxLength={DECK_NAME_MAX}
            placeholder="e.g. Cell biology"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="primary">
            Add deck
          </button>
        </div>
        {problem && <p className="error">{problem}</p>}
      </form>

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          message={`Its ${deleting.total} card${deleting.total === 1 ? '' : 's'} will be deleted from this device. This can’t be undone.`}
          confirmLabel="Delete deck"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const deck = deleting;
            setDeleting(null);
            await store.deleteDeck(deck.id).catch(() => {});
            await reload();
          }}
        />
      )}
    </section>
  );
}

function RenameForm({ deck, onDone }: { deck: DeckSummary; onDone: () => void }) {
  const store = useStore();
  const [name, setName] = useState(deck.name);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await store.renameDeck(deck.id, name);
      onDone();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };
  return (
    <form className="stack" onSubmit={save}>
      <label htmlFor={`rename-${deck.id}`}>New name for “{deck.name}”</label>
      <div className="row">
        <input
          id={`rename-${deck.id}`}
          value={name}
          maxLength={DECK_NAME_MAX}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      {problem && <p className="error">{problem}</p>}
    </form>
  );
}
