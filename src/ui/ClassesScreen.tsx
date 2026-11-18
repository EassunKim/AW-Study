// The home screen for now (milestone 5 puts today's checklist and Play here): your classes, a
// reminder for each lecture that hasn't been filled in, and the latest lectures with their slides.
import { useState } from 'react';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import type { CourseSummary, LectureWithSections, SlideDeck } from '../types/lecture';
import { describeMeetings, formatDate, latestLecture, orderSections, relativeDay, slidesLabel } from './classes';
import { ClassEditor } from './ClassEditor';
import { go, href } from './route';
import { DAY_START_HOUR } from './settings';
import { useStore } from './store-context';
import { useLoad } from './useLoad';

const LATEST_SHOWN = 5;

interface ClassData {
  course: CourseSummary;
  lectures: LectureWithSections[];
  decks: SlideDeck[];
}

export function ClassesScreen() {
  const store = useStore();
  const now = new Date();
  const today = studyDay(now, deviceTimeZone(), DAY_START_HOUR);
  const { data, error } = useLoad(async (): Promise<ClassData[]> => {
    const courses = await store.listCourses(today);
    return Promise.all(
      courses.map(async (course) => {
        const [lectures, decks] = await Promise.all([store.listLectures(course.id), store.listSlideDecks(course.id)]);
        return { course, lectures, decks };
      }),
    );
  }, [store, today]);
  const [adding, setAdding] = useState(false);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const thisYear = today.slice(0, 4);

  const toFill = data.flatMap(({ course, lectures }) => {
    const latest = latestLecture(course.meetings, now, deviceTimeZone());
    return latest && !lectures.some((l) => l.lecture.date === latest.date) ? [{ course, date: latest.date }] : [];
  });
  const recent = data
    .flatMap(({ course, lectures, decks }) => lectures.map((item) => ({ course, item, decks })))
    .sort((a, b) => b.item.lecture.date.localeCompare(a.item.lecture.date) || b.item.lecture.createdAt.localeCompare(a.item.lecture.createdAt))
    .slice(0, LATEST_SHOWN);

  return (
    <section>
      <h2>Classes</h2>
      {toFill.length > 0 && (
        <ul className="list" aria-label="Lectures to fill in">
          {toFill.map(({ course, date }) => (
            <li key={course.id} className="prompt">
              <a href={href({ name: 'class', courseId: course.id })}>
                {course.name}, {formatDate(date, thisYear)}: what did the lecture cover?
              </a>
            </li>
          ))}
        </ul>
      )}

      {data.length === 0 && !adding && (
        <p className="muted">No classes yet. Add each class you’re taking, with its lecture times, so Honed can plan your study around them.</p>
      )}
      <ul className="list" aria-label="Classes">
        {data.map(({ course }) => (
          <li key={course.id} className="item" data-testid="class-row">
            <a className="item-main item-link" href={href({ name: 'class', courseId: course.id })}>
              <strong className="item-name">{course.name}</strong>
              <span className="muted small">{describeMeetings(course.meetings)}</span>
              <span className="muted small">
                {course.lectureCount} lecture{course.lectureCount === 1 ? '' : 's'} · {course.deckCount} slide deck{course.deckCount === 1 ? '' : 's'}
              </span>
              {course.nextExam && (
                <span className="small">
                  {course.nextExam.title}: {formatDate(course.nextExam.date, thisYear)} ({relativeDay(today, course.nextExam.date)})
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>

      {adding ? (
        <ClassEditor onCancel={() => setAdding(false)} onSaved={(course) => go({ name: 'class', courseId: course.id })} />
      ) : (
        <button type="button" className={data.length === 0 ? 'primary wide' : 'wide'} onClick={() => setAdding(true)}>
          Add a class
        </button>
      )}

      {recent.length > 0 && (
        <>
          <h3>Latest lectures</h3>
          <ul className="list" aria-label="Latest lectures">
            {recent.map(({ course, item, decks }) => (
              <li key={item.lecture.id} className="item">
                <div className="item-main">
                  <span>
                    <strong>{course.name}</strong> <span className="muted small">{formatDate(item.lecture.date, thisYear)}</span>
                  </span>
                  {orderSections(item.sections, decks).map((s) => (
                    <a key={s.id} className="small" href={href({ name: 'slides', courseId: course.id, deckId: s.deckId, first: s.firstPage, last: s.lastPage })}>
                      {decks.find((d) => d.id === s.deckId)?.title ?? 'Slides'}, {slidesLabel(s.firstPage, s.lastPage)}
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted small old-cards">
        <a href={href({ name: 'decks' })}>Old flashcards</a> (from the first prototype; going away soon)
      </p>
    </section>
  );
}
