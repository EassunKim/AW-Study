// "What was covered?": a lecture's date and length, and the slides it covered: one or more ranges,
// each from a deck already added to the class or a PDF picked now. New PDFs are stored when the
// lecture is saved. It suggests carrying on from where the last lecture stopped.
import { useState, type FormEvent } from 'react';
import type { Course, LectureWithSections, SlideDeck } from '../types/lecture';
import { carryOn, slidesLabel, titleFromFileName } from './classes';
import { PdfProblem, readPdfFile, type PickedPdf } from './pdf-file';
import { jobLabel, useBankJobs } from './bank-jobs';
import { useStore } from './store-context';
import { messageOf } from './useLoad';

type Source = { kind: 'deck'; deck: SlideDeck } | { kind: 'file'; pdf: PickedPdf };

interface Part {
  source: Source | null;
  first: string;
  last: string;
  reading: boolean;
  problem: string | null;
}

const emptyPart = (): Part => ({ source: null, first: '', last: '', reading: false, problem: null });
const pageCount = (s: Source) => (s.kind === 'deck' ? s.deck.pageCount : s.pdf.pageTexts.length);
const sourceTitle = (s: Source) => (s.kind === 'deck' ? s.deck.title : titleFromFileName(s.pdf.fileName));

export function LectureForm({
  course,
  decks,
  lectures,
  defaults,
  onSaved,
  onCancel,
}: {
  course: Course;
  decks: SlideDeck[];
  lectures: LectureWithSections[];
  defaults: { date: string; minutes: number | null };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const store = useStore();
  const suggestion = carryOn(lectures, decks);
  const [date, setDate] = useState(defaults.date);
  const [minutes, setMinutes] = useState(defaults.minutes ? String(defaults.minutes) : '');
  const [parts, setParts] = useState<Part[]>(() => [
    suggestion ? { ...emptyPart(), source: { kind: 'deck', deck: suggestion.deck }, first: String(suggestion.next) } : emptyPart(),
  ]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [makeQuestions, setMakeQuestions] = useState(true);
  const jobs = useBankJobs();

  const setPart = (i: number, change: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...change } : p)));

  const pick = async (i: number, file: File | undefined) => {
    if (!file) return;
    setPart(i, { reading: true, problem: null, source: null });
    try {
      const pdf = await readPdfFile(file);
      setPart(i, { reading: false, source: { kind: 'file', pdf }, first: '1', last: '' });
    } catch (err) {
      setPart(i, { reading: false, problem: err instanceof PdfProblem ? err.message : 'That PDF couldn’t be read.' });
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const length = Number(minutes);
    if (!date) return setProblem('Give the lecture’s date.');
    if (!Number.isInteger(length) || length < 1 || length > 600) return setProblem('A lecture lasts between 1 and 600 minutes.');
    for (const [i, p] of parts.entries()) {
      const which = parts.length > 1 ? ` (slides ${i + 1})` : '';
      if (!p.source) return setProblem(`Choose the slides${which}: a deck, or upload a PDF.`);
      const first = Number(p.first);
      const last = Number(p.last);
      const count = pageCount(p.source);
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < 1 || !p.first || !p.last) {
        return setProblem(`Give the first and last slide covered${which}.`);
      }
      if (first > last) return setProblem(`The first slide comes before the last one${which}.`);
      if (last > count) return setProblem(`“${sourceTitle(p.source)}” has only ${count} slide${count === 1 ? '' : 's'}.`);
    }
    setSaving(true);
    try {
      // Store new PDFs first; each part then points at its deck, so a retry doesn't store it twice
      const stored: SlideDeck[] = [];
      for (const [i, p] of parts.entries()) {
        if (p.source?.kind === 'file') {
          const { pdf } = p.source;
          const deck = await store.addSlideDeck({
            courseId: course.id,
            title: titleFromFileName(pdf.fileName),
            fileName: pdf.fileName,
            data: pdf.data,
            pageTexts: pdf.pageTexts,
          });
          setPart(i, { source: { kind: 'deck', deck } });
          stored[i] = deck;
        } else if (p.source) stored[i] = p.source.deck;
      }
      const { sections } = await store.recordLecture({
        courseId: course.id,
        date,
        minutes: length,
        sections: parts.map((p, i) => ({ deckId: stored[i]!.id, firstPage: Number(p.first), lastPage: Number(p.last) })),
      });
      // The quiz questions, made in the background so they're ready the first time they're wanted
      if (makeQuestions) {
        const title = (deckId: string) => stored.find((d) => d.id === deckId)?.title ?? 'Slides';
        jobs.enqueue(sections.map((s) => ({ sectionId: s.id, label: jobLabel(title(s.deckId), s.firstPage, s.lastPage) })));
      }
      onSaved();
    } catch (err) {
      setProblem(messageOf(err));
      setSaving(false);
    }
  };

  return (
    <form className="editor stack" noValidate onSubmit={save} aria-label="What was covered?">
      <h3 className="form-title">What was covered?</h3>
      <div className="row">
        <label className="inline">
          Lecture date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="inline">
          Minutes
          <input type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>

      {parts.map((p, i) => (
        <fieldset key={i} className="stack part">
          <legend>Slides {i + 1}</legend>
          {decks.length > 0 && (
            <div className="choices" role="group" aria-label="Slide decks">
              {decks.map((deck) => (
                <button
                  key={deck.id}
                  type="button"
                  aria-pressed={p.source?.kind === 'deck' && p.source.deck.id === deck.id}
                  onClick={() => setPart(i, { source: { kind: 'deck', deck }, problem: null })}
                >
                  {deck.title} <span className="muted small">{deck.pageCount} slides</span>
                </button>
              ))}
            </div>
          )}
          <label className="file">
            {decks.length > 0 ? 'Or upload a new PDF' : 'Upload the slides (PDF)'}
            <input type="file" accept="application/pdf,.pdf" disabled={p.reading || saving} onChange={(e) => void pick(i, e.target.files?.[0])} />
          </label>
          {p.reading && <p className="muted small">Reading the PDF…</p>}
          {p.problem && (
            <p className="error" role="alert">
              {p.problem}
            </p>
          )}
          {p.source && (
            <>
              <p className="muted small" data-testid="chosen-slides">
                {sourceTitle(p.source)}: {pageCount(p.source)} slides
                {p.source.kind === 'file' && ' (new)'}
                {suggestion && i === 0 && p.source.kind === 'deck' && p.source.deck.id === suggestion.deck.id && (
                  <> · the last lecture ended at slide {suggestion.next - 1}</>
                )}
              </p>
              <div className="row">
                <label className="inline">
                  First slide
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={pageCount(p.source)}
                    value={p.first}
                    onChange={(e) => setPart(i, { first: e.target.value })}
                  />
                </label>
                <label className="inline">
                  Last slide
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={pageCount(p.source)}
                    value={p.last}
                    onChange={(e) => setPart(i, { last: e.target.value })}
                  />
                </label>
              </div>
              {p.first && p.last && Number(p.first) <= Number(p.last) && (
                <p className="muted small">{slidesLabel(Number(p.first), Number(p.last))}</p>
              )}
            </>
          )}
          {parts.length > 1 && (
            <button type="button" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
              Remove these slides
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" onClick={() => setParts((ps) => [...ps, emptyPart()])}>
        Add slides from another deck
      </button>

      <label className="check">
        <input type="checkbox" checked={makeQuestions} onChange={(e) => setMakeQuestions(e.target.checked)} />
        Make quiz questions now (uses AI, in the background)
      </label>

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row end">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving || parts.some((p) => p.reading)}>
          {saving ? 'Saving…' : 'Save lecture'}
        </button>
      </div>
    </form>
  );
}
