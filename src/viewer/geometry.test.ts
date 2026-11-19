import { describe, expect, it } from 'vitest';
import { boxBetween, lineRects, percent, textInArea, toPagePoint, toPageRect } from './geometry';

const page = { left: 100, top: 50, width: 400, height: 300 };

describe('toPageRect', () => {
  it('turns a box on screen into fractions of the page', () => {
    expect(toPageRect({ left: 200, top: 110, width: 100, height: 30 }, page)).toEqual({ x: 0.25, y: 0.2, w: 0.25, h: 0.1 });
  });
  it('cuts a box to the page, and gives null for one off it', () => {
    expect(toPageRect({ left: 50, top: 20, width: 100, height: 60 }, page)).toEqual({ x: 0, y: 0, w: 0.125, h: 0.1 });
    expect(toPageRect({ left: 450, top: 300, width: 200, height: 200 }, page)).toEqual({ x: 0.875, y: 0.8333, w: 0.125, h: 0.1667 });
    expect(toPageRect({ left: 600, top: 60, width: 10, height: 10 }, page)).toBeNull();
    expect(toPageRect({ left: 200, top: 110, width: 0, height: 30 }, page)).toBeNull();
    expect(toPageRect({ left: 200, top: 110, width: 10, height: 10 }, { ...page, width: 0 })).toBeNull();
  });
  it('never gives a box past the page edge, even after rounding', () => {
    const r = toPageRect({ left: 100 + 400 / 3, top: 50, width: 400, height: 300 }, page)!;
    expect(r.x + r.w).toBeLessThanOrEqual(1.000001); // the store's own allowance
    expect(r.y + r.h).toBeLessThanOrEqual(1.000001);
  });
});

describe('toPagePoint', () => {
  it('gives a point with no size, or null off the page', () => {
    expect(toPagePoint(300, 200, page)).toEqual({ x: 0.5, y: 0.5, w: 0, h: 0 });
    expect(toPagePoint(99, 200, page)).toBeNull();
    expect(toPagePoint(300, 351, page)).toBeNull();
  });
});

describe('boxBetween', () => {
  it('works whichever corner comes first, and stays on the page', () => {
    expect(boxBetween({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.6 });
    expect(boxBetween({ x: -0.5, y: 0.5 }, { x: 1.5, y: 0.6 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.1 });
  });
});

describe('lineRects', () => {
  it('joins the boxes on one line and keeps lines apart', () => {
    const rects = [
      { x: 0.1, y: 0.2, w: 0.2, h: 0.05 },
      { x: 0.3, y: 0.201, w: 0.2, h: 0.049 }, // the next word run, touching
      { x: 0.1, y: 0.2, w: 0.4, h: 0.05 }, // a duplicate for the whole element
      { x: 0.1, y: 0.26, w: 0.3, h: 0.05 }, // the next line
      { x: 0.5, y: 0.3, w: 0, h: 0.05 }, // an empty run
    ];
    expect(lineRects(rects)).toEqual([
      { x: 0.1, y: 0.2, w: 0.4, h: 0.05 },
      { x: 0.1, y: 0.26, w: 0.3, h: 0.05 },
    ]);
  });
  it('keeps two columns on the same line apart', () => {
    expect(
      lineRects([
        { x: 0.6, y: 0.2, w: 0.2, h: 0.05 },
        { x: 0.1, y: 0.2, w: 0.2, h: 0.05 },
      ]),
    ).toHaveLength(2);
  });
});

describe('textInArea', () => {
  it('takes the pieces whose centre is in the box, in order', () => {
    const pieces = [
      { rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, text: 'Title' },
      { rect: { x: 0.1, y: 0.5, w: 0.2, h: 0.05 }, text: 'inside ' },
      { rect: { x: 0.35, y: 0.5, w: 0.2, h: 0.05 }, text: 'too' },
      { rect: { x: 0.5, y: 0.5, w: 0.4, h: 0.05 }, text: 'half out' },
      { rect: { x: 0.1, y: 0.55, w: 0.2, h: 0.05 }, text: '  ' },
    ];
    expect(textInArea({ x: 0, y: 0.4, w: 0.6, h: 0.3 }, pieces)).toBe('inside too');
  });
});

it('percent', () => {
  expect(percent(0.12345)).toBe('12.345%');
  expect(percent(1)).toBe('100%');
});
