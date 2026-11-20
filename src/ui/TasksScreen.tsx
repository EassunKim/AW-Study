// The Tasks page (#/, the home page and one of the three main pages): today's work.
import { Today } from './Today';

export function TasksScreen() {
  return (
    <section aria-labelledby="tasks-title">
      <h2 id="tasks-title">Tasks</h2>
      <Today />
    </section>
  );
}
