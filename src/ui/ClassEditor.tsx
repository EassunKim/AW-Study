// Adding or editing a class: its name, its lecture times (days that share a start and length go
// together: "Mon, Wed, Fri at 10:30 for 50 min"), and optional term dates. Days are buttons, not a
// <select>: WebKit's select pulls in a stylesheet our Content-Security-Policy blocks.
import { useState, type FormEvent } from 'react';
import { COURSE_NAME_MAX } from '../db/lectures';
import type { Course } from '../types/lecture';
import { DAY_NAMES, expandGroups, groupMeetings, WEEK, type MeetingGroup } from './classes';
import { useStore } from './store-context';
import { messageOf } from './useLoad';

interface GroupDraft {
  days: MeetingGroup['days'];
  start: string;
  minutes: string;
}

const emptyGroup = (): GroupDraft => ({ days: [], start: '', minutes: '50' });

export function ClassEditor({ course, onSaved, onCancel }: { course?: Course; onSaved: (course: Course) => void; onCancel: () => void }) {
  const store = useStore();
  const [name, setName] = useState(course?.name ?? '');
  const [groups, setGroups] = useState<GroupDraft[]>(() => {
    const existing = course ? groupMeetings(course.meetings) : [];
    return existing.length ? existing.map((g) => ({ ...g, minutes: String(g.minutes) })) : [emptyGroup()];
  });
  const [termStart, setTermStart] = useState(course?.termStart ?? '');
  const [termEnd, setTermEnd] = useState(course?.termEnd ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const idBase = course?.id ?? 'new';

  const setGroup = (i: number, change: Partial<GroupDraft>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...change } : g)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    // A lecture-time row left completely empty is ignored; a half-filled one is a mistake
    const filled = groups.filter((g) => g.days.length || g.start);
    for (const g of filled) {
      if (!g.days.length) return setProblem('Pick the days for each lecture time.');
      if (!g.start) return setProblem('Give each lecture time a start time.');
      const minutes = Number(g.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return setProblem('A lecture lasts between 1 and 600 minutes.');
    }
    const meetings = expandGroups(filled.map((g) => ({ days: g.days, start: g.start, minutes: Number(g.minutes) })));
    const input = { name, meetings, termStart: termStart || null, termEnd: termEnd || null };
    setSaving(true);
    try {
      onSaved(course ? await store.updateCourse(course.id, input) : await store.createCourse(input));
    } catch (err) {
      setProblem(messageOf(err));
      setSaving(false);
    }
  };

  return (
    <form className="editor stack" noValidate onSubmit={save} aria-label={course ? `Edit ${course.name}` : 'New class'}>
      <label htmlFor={`${idBase}-name`}>Class name</label>
      <input
        id={`${idBase}-name`}
        value={name}
        maxLength={COURSE_NAME_MAX}
        placeholder="e.g. CHEM 101"
        autoFocus={!course}
        onChange={(e) => setName(e.target.value)}
      />

      <fieldset className="stack plain">
        <legend>Lecture times</legend>
        {groups.map((g, i) => (
          <div key={i} className="meeting" data-testid="meeting">
            <div className="days" role="group" aria-label={`Days for lecture time ${i + 1}`}>
              {WEEK.map((day) => (
                <button
                  key={day}
                  type="button"
                  className="day"
                  aria-pressed={g.days.includes(day)}
                  onClick={() => setGroup(i, { days: g.days.includes(day) ? g.days.filter((d) => d !== day) : [...g.days, day] })}
                >
                  {DAY_NAMES[day]}
                </button>
              ))}
            </div>
            <div className="row">
              <label className="inline">
                Starts at
                <input type="time" value={g.start} onChange={(e) => setGroup(i, { start: e.target.value })} />
              </label>
              <label className="inline">
                Minutes
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  value={g.minutes}
                  onChange={(e) => setGroup(i, { minutes: e.target.value })}
                />
              </label>
              {groups.length > 1 && (
                <button type="button" onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))} aria-label={`Remove lecture time ${i + 1}`}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setGroups((gs) => [...gs, emptyGroup()])}>
          Add another lecture time
        </button>
        <p className="muted small">Days with the same start and length go together, e.g. Mon, Wed, Fri at 10:30 for 50 minutes.</p>
      </fieldset>

      <fieldset className="stack plain">
        <legend>Term (optional)</legend>
        <div className="row">
          <label className="inline">
            Starts
            <input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} />
          </label>
          <label className="inline">
            Ends
            <input type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
          </label>
        </div>
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
        <button type="submit" className="primary" disabled={saving}>
          {course ? 'Save class' : 'Add class'}
        </button>
      </div>
    </form>
  );
}
