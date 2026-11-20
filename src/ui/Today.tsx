// Today's checklist on the Tasks page, the home page (#47, DESIGN "A normal day"): what the planner
// fitted into today's minutes, a big Play button that runs through it, what's waiting beyond today's
// time, and the daily minutes setting. (Its look changes to docs/design's rows by class in step 2.)
import { useState, type FormEvent } from 'react';
import { APP_NAME } from '../brand';
import { DAILY_MINUTES_MAX, DAILY_MINUTES_MIN } from '../db/plan';
import { href } from './route';
import { describeItem, loadPlanning } from './planning';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

export function Today() {
  const store = useStore();
  const { data, error, reload } = useLoad(() => loadPlanning(store), [store]);
  const [editing, setEditing] = useState(false);

  if (error) return <p className="error">{error}</p>;
  if (!data) return null;
  const { plan, place } = data;
  const items = plan.today.filter((i) => place(i.sectionId));
  const later = plan.later.filter((i) => place(i.sectionId));
  if (!data.hasLectures) {
    // Nothing to plan until a lecture is recorded
    return (
      <p className="muted" data-testid="tasks-empty">
        Nothing to study yet. Add your classes in <a href={href({ name: 'classes' })}>Classes</a>, and after each lecture tell{' '}
        {APP_NAME} what it covered.
      </p>
    );
  }

  return (
    <section className="today" aria-label="Today">
      <p className="muted small" data-testid="today-minutes">
        {plan.doneMinutes > 0 && `${plan.doneMinutes} min done · `}
        {items.length > 0 ? `${plan.plannedMinutes} min planned` : 'Nothing left for today'} of {plan.dailyMinutes} min a day{' '}
        {!editing && (
          <button type="button" className="link" onClick={() => setEditing(true)}>
            change
          </button>
        )}
      </p>
      {editing && (
        <DailyMinutes
          current={plan.dailyMinutes}
          onDone={async () => {
            setEditing(false);
            await reload();
          }}
        />
      )}
      {items.length === 0 ? (
        <p className="muted">{plan.doneMinutes > 0 ? 'All done for today.' : 'Nothing due today. New lectures start the day after.'}</p>
      ) : (
        <>
          <a className="button primary wide play" href={href({ name: 'play' })}>
            ▶ Play
          </a>
          {plan.overBudget && <p className="muted small">That’s more than your daily time, but it’s one session: it doesn’t split.</p>}
          <ol className="list checklist" aria-label="Today’s checklist">
            {items.map((item) => {
              const text = describeItem(item, place(item.sectionId)!);
              return (
                <li key={`${item.kind}-${item.sectionId}`} className="item" data-testid="today-item">
                  <div className="item-main">
                    <span>{text.title}</span>
                    <span className="muted small">{text.detail}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {later.length > 0 && (
        <details className="later">
          <summary data-testid="later-count">
            {later.length} more waiting beyond today’s time (they move to the coming days)
          </summary>
          <ul className="list">
            {later.map((item) => {
              const text = describeItem(item, place(item.sectionId)!);
              return (
                <li key={`${item.kind}-${item.sectionId}`} className="item">
                  <div className="item-main">
                    <span>{text.title}</span>
                    <span className="muted small">{text.detail}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

function DailyMinutes({ current, onDone }: { current: number; onDone: () => void }) {
  const store = useStore();
  const [value, setValue] = useState(String(current));
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await store.saveStudySettings({ dailyMinutes: Number(value) });
      onDone();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };
  return (
    <form className="row" noValidate onSubmit={save} aria-label="Daily study time">
      <label className="inline">
        Minutes a day
        <input type="number" inputMode="numeric" min={DAILY_MINUTES_MIN} max={DAILY_MINUTES_MAX} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="submit" className="primary">
        Save
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
