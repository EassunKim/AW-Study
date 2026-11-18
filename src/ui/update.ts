// When a new version of the app arrives (the service worker installs it in the background), the page
// must reload to use it. Reloading locks the app, so doing it at any moment asked for the passkey a
// second time and could throw away a quiz in progress (Nathan, Nov 18). Now:
// - locked, and no unlock started: reload at once (nothing to lose, no passkey asked yet);
// - unlocked, or an unlock under way: wait, show "A new version is ready" with Reload, and reload
//   the next time the app is locked.
// main.tsx sends the service worker's "ready to reload" here (updateReady); the app tells it what it's
// doing (setActivity), and the banner listens (onUpdateChange).

export type Activity = 'locked' | 'unlocking' | 'unlocked';
export type Decision = 'reload' | 'wait';

/** What to do when a new version is ready. */
export function decideUpdate(activity: Activity): Decision {
  return activity === 'locked' ? 'reload' : 'wait';
}

let activity: Activity = 'locked';
let ready = false;
const listeners = new Set<(ready: boolean) => void>();
let reloadPage = () => window.location.reload();

/** The service worker has a new version waiting to be used. */
export function updateReady() {
  if (decideUpdate(activity) === 'reload') return reloadPage();
  ready = true;
  for (const listener of listeners) listener(true);
}

/** What the app is doing: a waiting update is applied as soon as it's safe (back to locked). */
export function setActivity(next: Activity) {
  activity = next;
  if (ready && next === 'locked') reloadPage();
}

export function isUpdateReady(): boolean {
  return ready;
}

export function onUpdateChange(listener: (ready: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests. */
export function resetUpdate(options: { reload?: () => void } = {}) {
  activity = 'locked';
  ready = false;
  listeners.clear();
  reloadPage = options.reload ?? (() => window.location.reload());
}
