import { describe, expect, it } from 'vitest';
import { fitPage, REAL_SIZE } from './fit';

const LETTER = { width: 612, height: 792 }; // US Letter, portrait, in points
const SLIDE = { width: 720, height: 540 }; // a 4:3 slide
const PHONE = { width: 390, height: 360 }; // the stage on an iPhone, between the bar and the thumbnails
const DESKTOP = { width: 1240, height: 560 };

describe('fitPage', () => {
  it('fits a portrait page to the width on a phone, and offers the whole page', () => {
    const f = fitPage(LETTER, PHONE, null);
    expect(f).toMatchObject({ fit: 'width', choice: true });
    expect(LETTER.width * f.scale).toBeCloseTo(PHONE.width);
    expect(LETTER.height * f.scale).toBeGreaterThan(PHONE.height); // it scrolls
  });

  it('shows the whole page when the user chose it', () => {
    const f = fitPage(LETTER, PHONE, 'page');
    expect(f.fit).toBe('page');
    expect(LETTER.height * f.scale).toBeCloseTo(PHONE.height);
    expect(LETTER.width * f.scale).toBeLessThanOrEqual(PHONE.width);
  });

  it('never draws a page past its real size on a wide screen', () => {
    const f = fitPage(LETTER, DESKTOP, null);
    expect(f).toMatchObject({ fit: 'width', choice: true });
    expect(f.scale).toBe(REAL_SIZE);
    expect(LETTER.width * f.scale).toBeLessThan(DESKTOP.width);
  });

  it('keeps a landscape slide whole, and offers no switch when it fills the width already', () => {
    expect(fitPage(SLIDE, PHONE, null)).toEqual({ fit: 'page', scale: PHONE.width / SLIDE.width, choice: false });
    // Even if the user chose fit width on an earlier, portrait page
    expect(fitPage(SLIDE, PHONE, 'width').fit).toBe('page');
  });

  it('keeps a landscape slide whole by default on a short, wide stage, with fit width on offer', () => {
    const stage = { width: 1240, height: 300 };
    const f = fitPage(SLIDE, stage, null);
    expect(f).toMatchObject({ fit: 'page', choice: true, scale: 300 / 540 });
    expect(fitPage(SLIDE, stage, 'width').scale).toBe(REAL_SIZE);
  });

  it('offers no switch when fit width would hardly be bigger', () => {
    // A page only a little taller than wide, on a stage of the same shape: the whole page fills the width
    const f = fitPage({ width: 600, height: 640 }, { width: 400, height: 420 }, null);
    expect(f).toMatchObject({ fit: 'page', choice: false });
  });

  it('a page already shown at real size or more as a whole page has nothing to gain', () => {
    const f = fitPage(LETTER, { width: 2000, height: 1400 }, null);
    expect(f).toMatchObject({ fit: 'page', choice: false });
    expect(f.scale).toBeCloseTo(1400 / 792);
  });
});
