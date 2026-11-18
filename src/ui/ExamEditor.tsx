// Adding or editing an exam: title, kind, date, and what it covers (every lecture up to it, the
// default, or chosen lectures).
import { useState, type FormEvent } from 'react';
import { EXAM_TITLE_MAX } from '../db/lectures';
import type { Exam, ExamKind, LectureWithSections } from '../types/lecture';
import { formatDate } from './classes';
import { useStore } from './store-context';
import { messageOf } from './useLoad';

const KINDS: [ExamKind, string][] = [
  ['midterm', 'Midterm'],
  ['final', 'Final'],
  ['test', 'Test'],
];
export const KIND_NAMES: Record<ExamKind, string> = { midterm: 'Midterm', final: 'Final', test: 'Test' };

export function ExamEditor({
  courseId,
  exam,
  lectures,
  onSaved,
  onCancel,
}: {
  courseId: string;
  exam?: Exam;
  lectures: LectureWithSections[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const store = useStore();
  const [title, setTitle] = useState(exam?.title ?? '');
  const [kind, setKind] = useState<ExamKind>(exam?.kind ?? 'midterm');
  const [date, setDate] = useState(exam?.date ?? '');
  const [chosen, setChosen] = useState<string[] | null>(exam?.lectureIds ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const idBase = exam?.id ?? 'new-exam';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!date) return setProblem('Give the exam a date.');
    if (chosen && chosen.length === 0) return setProblem('Choose at least one lecture, or let it cover every lecture.');
    // An empty title takes the kind's name ("Midterm")
    const input = { courseId, title: title.trim() || KIND_NAMES[kind], kind, date, lectureIds: chosen };
    try {
      if (exam) await store.updateExam(exam.id, input);
      else await store.addExam(input);
      onSaved();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };

  return (
    <form className="editor stack" noValidate onSubmit={save} aria-label={exam ? `Edit ${exam.title}` : 'New exam'}>
      <div className="segmented" role="group" aria-label="Kind of exam">
        {KINDS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
            {label}
          </button>
        ))}
      </div>
      <label htmlFor={`${idBase}-title`}>Title (optional)</label>
      <input
        id={`${idBase}-title`}
        value={title}
        maxLength={EXAM_TITLE_MAX}
        placeholder={`e.g. ${KIND_NAMES[kind]} 1`}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor={`${idBase}-date`}>Exam date</label>
      <input id={`${idBase}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />

      <fieldset className="stack plain">
        <legend>It covers</legend>
        <label className="check">
          <input type="radio" name={`${idBase}-covers`} checked={chosen === null} onChange={() => setChosen(null)} />
          Every lecture up to the exam
        </label>
        <label className="check">
          <input type="radio" name={`${idBase}-covers`} checked={chosen !== null} onChange={() => setChosen(chosen ?? [])} />
          Chosen lectures
        </label>
        {chosen !== null &&
          (lectures.length === 0 ? (
            <p className="muted small">No lectures recorded yet.</p>
          ) : (
            <div className="stack indent">
              {lectures.map(({ lecture }) => (
                <label key={lecture.id} className="check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(lecture.id)}
                    onChange={(e) => setChosen(e.target.checked ? [...chosen, lecture.id] : chosen.filter((id) => id !== lecture.id))}
                  />
                  Lecture of {formatDate(lecture.date)}
                </label>
              ))}
            </div>
          ))}
      </fieldset>

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row end">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary">
          {exam ? 'Save exam' : 'Add exam'}
        </button>
      </div>
    </form>
  );
}
