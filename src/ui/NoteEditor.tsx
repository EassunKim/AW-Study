// Writing or editing a note. Basic: front and back. Cloze: text with {{c1::answer}} blanks (and an
// optional extra shown after answering); problems show as you type, and each card is previewed as
// it will look in review. The kind is a pair of buttons, not a <select> (WebKit's <select> pulls a
// stylesheet our security policy blocks).
import { useMemo, useState, type FormEvent } from 'react';
import type { NoteWithCards } from '../db/store';
import { checkCloze, renderCloze } from '../lib/cloze';
import type { NoteKind } from '../types/study';
import { ClozeText, PlainText } from './CardText';
import { useStore } from './store-context';
import { messageOf } from './useLoad';

export function NoteEditor({
  deckId,
  editing,
  onSaved,
  onCancel,
}: {
  deckId: string;
  editing?: NoteWithCards;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const store = useStore();
  const [kind, setKind] = useState<NoteKind>(editing?.note.kind ?? 'basic');
  const [front, setFront] = useState(editing?.note.front ?? '');
  const [back, setBack] = useState(editing?.note.back ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cloze = useMemo(() => (kind === 'cloze' && front.trim() ? checkCloze(front) : null), [kind, front]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) await store.updateNote(editing.note.id, { front, back });
      else await store.addNote({ deckId, kind, front, back });
      onSaved();
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="editor stack" onSubmit={save} aria-label={editing ? 'Edit note' : 'New note'}>
      {!editing && (
        <div className="segmented" role="group" aria-label="Kind of note">
          <button type="button" aria-pressed={kind === 'basic'} onClick={() => setKind('basic')}>
            Basic
          </button>
          <button type="button" aria-pressed={kind === 'cloze'} onClick={() => setKind('cloze')}>
            Cloze
          </button>
        </div>
      )}

      {kind === 'basic' ? (
        <>
          <label htmlFor="note-front">Front (the question)</label>
          <textarea id="note-front" rows={3} value={front} onChange={(e) => setFront(e.target.value)} />
          <label htmlFor="note-back">Back (the answer)</label>
          <textarea id="note-back" rows={3} value={back} onChange={(e) => setBack(e.target.value)} />
        </>
      ) : (
        <>
          <label htmlFor="note-front">Text, with blanks like {'{{c1::answer}}'} or {'{{c1::answer::hint}}'}</label>
          <textarea id="note-front" rows={4} value={front} onChange={(e) => setFront(e.target.value)} />
          {cloze && !cloze.ok && (
            <p className="error" data-testid="cloze-problem">
              {cloze.error}
            </p>
          )}
          <label htmlFor="note-back">Extra (optional, shown after answering)</label>
          <textarea id="note-back" rows={2} value={back} onChange={(e) => setBack(e.target.value)} />
          {cloze?.ok && (
            <div className="previews" aria-label="Card previews">
              {cloze.numbers.map((n) => (
                <div key={n} className="preview" data-testid="cloze-preview">
                  <span className="muted">Card {n}</span>
                  <ClozeText segments={renderCloze(front, n, 'front')} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {kind === 'basic' && front.trim() && (
        <div className="previews" aria-label="Card preview">
          <div className="preview">
            <span className="muted">Card</span>
            <PlainText text={front} />
          </div>
        </div>
      )}

      {problem && <p className="error">{problem}</p>}
      <div className="row end">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {editing ? 'Save changes' : 'Add note'}
        </button>
      </div>
    </form>
  );
}
