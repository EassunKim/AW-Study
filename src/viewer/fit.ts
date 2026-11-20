// How a page fits the viewer's stage (#46): the whole page, or "fit width" for portrait pages (a Word
// document saved as PDF), which fills the stage's width and scrolls down, so its text isn't tiny on a
// phone. Pure, so it's tested on its own (fit.test.ts).

export interface Size {
  width: number;
  height: number;
}

export type Fit = 'page' | 'width';

/**
 * Fit width never draws a page bigger than this many CSS pixels per PDF point: its real size (a point is
 * 1/72 inch, a CSS pixel 1/96), PDF.js's own "100%". On a wide screen a portrait page then stays a
 * readable page, not 1,300 pixels wide.
 */
export const REAL_SIZE = 96 / 72;

/** Fit width is only offered when it draws the page at least this much bigger than the whole page. */
export const WORTH_IT = 1.25;

export interface PageFit {
  /** How the page is shown. */
  fit: Fit;
  /** PDF.js's scale for it (before zooming in). */
  scale: number;
  /** Whether the two fits differ enough to offer a switch between them. */
  choice: boolean;
}

/**
 * The fit for a page of this size on a stage of this size. `chosen` is the user's choice, if they made
 * one; otherwise fit width is picked for portrait pages and the whole page for everything else.
 */
export function fitPage(page: Size, stage: Size, chosen: Fit | null): PageFit {
  const whole = Math.min(stage.width / page.width, stage.height / page.height);
  const across = Math.min(stage.width / page.width, Math.max(whole, REAL_SIZE));
  const choice = across >= whole * WORTH_IT;
  if (!choice) return { fit: 'page', scale: whole, choice };
  const fit = chosen ?? (page.height > page.width ? 'width' : 'page');
  return { fit, scale: fit === 'width' ? across : whole, choice };
}
