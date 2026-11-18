import { describe, expect, it } from 'vitest';
import { checkCloze, renderCloze } from './cloze';

describe('checkCloze', () => {
  it('accepts one cloze', () => {
    expect(checkCloze('The {{c1::mitochondria}} makes energy.')).toEqual({ ok: true, numbers: [1] });
  });

  it('lists each number once, sorted', () => {
    expect(checkCloze('{{c3::a}} {{c1::b}} {{c3::c::hint}} {{c2::d}}')).toEqual({ ok: true, numbers: [1, 2, 3] });
  });

  it('accepts hints, 99, and leading zeros', () => {
    expect(checkCloze('{{c99::ATP::energy molecule}}')).toEqual({ ok: true, numbers: [99] });
    expect(checkCloze('{{c07::x}}')).toEqual({ ok: true, numbers: [7] });
  });

  it('treats a lone }} as text', () => {
    expect(checkCloze('a }} b {{c1::c}}')).toEqual({ ok: true, numbers: [1] });
  });

  it.each([
    ['', 'no cloze'],
    ['Just some text.', 'no cloze'],
    ['The {{c1::mitochondria makes energy.', 'unclosed'],
    ['{{c1::outer {{c2::inner}} }}', 'nested'],
    ['{{c0::x}}', 'zero'],
    ['{{c1.5::x}}', 'not whole'],
    ['{{cx::x}}', 'not a number'],
    ['{{c::x}}', 'no number'],
    ['{{c100::x}}', 'above 99'],
    ['{{c1::}}', 'empty answer'],
    ['{{c1::   ::hint}}', 'blank answer with hint'],
    ['{{note}}', 'not a cloze'],
    ['{{c1 x}}', 'no ::'],
    ['ok {{c1::a}} then {{c2::', 'unclosed after a good one'],
  ])('rejects %j (%s) with a message', (text) => {
    const result = checkCloze(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('gives a message that names the problem', () => {
    const error = (text: string) => {
      const result = checkCloze(text);
      return result.ok ? '' : result.error;
    };
    expect(error('plain')).toMatch(/no cloze/i);
    expect(error('{{c1::x')).toMatch(/closing/i);
    expect(error('{{c1::{{c2::x}}}}')).toMatch(/nested/i);
    expect(error('{{c0::x}}')).toMatch(/start at 1/i);
    expect(error('{{c1.5::x}}')).toMatch(/whole number/i);
    expect(error('{{c100::x}}')).toMatch(/99/);
    expect(error('{{c1::}}')).toMatch(/empty answer/i);
  });
});

describe('renderCloze', () => {
  const text = 'The {{c1::mitochondria}} makes {{c2::ATP::energy molecule}}.';

  it('blanks card n on the front and shows other clozes as text', () => {
    expect(renderCloze(text, 1, 'front')).toEqual([
      { kind: 'text', text: 'The ' },
      { kind: 'blank', hint: null },
      { kind: 'text', text: ' makes ATP.' },
    ]);
    expect(renderCloze(text, 2, 'front')).toEqual([
      { kind: 'text', text: 'The mitochondria makes ' },
      { kind: 'blank', hint: 'energy molecule' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('reveals the answers on the back', () => {
    expect(renderCloze(text, 2, 'back')).toEqual([
      { kind: 'text', text: 'The mitochondria makes ' },
      { kind: 'answer', text: 'ATP' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('hides every cloze with the same number together', () => {
    expect(renderCloze('{{c1::Paris}} is in {{c1::France}}, {{c2::Rome}} in Italy', 1, 'front')).toEqual([
      { kind: 'blank', hint: null },
      { kind: 'text', text: ' is in ' },
      { kind: 'blank', hint: null },
      { kind: 'text', text: ', Rome in Italy' },
    ]);
  });

  it('merges neighbouring text into one segment', () => {
    expect(renderCloze('{{c2::a}}{{c3::b}} c {{c1::d}}', 1, 'front')).toEqual([
      { kind: 'text', text: 'ab c ' },
      { kind: 'blank', hint: null },
    ]);
  });

  it('treats an empty hint as no hint', () => {
    expect(renderCloze('{{c1::x::}}', 1, 'front')).toEqual([{ kind: 'blank', hint: null }]);
  });

  it('keeps markup as plain text', () => {
    expect(renderCloze('<b>{{c1::<i>x</i>}}</b>', 1, 'back')).toEqual([
      { kind: 'text', text: '<b>' },
      { kind: 'answer', text: '<i>x</i>' },
      { kind: 'text', text: '</b>' },
    ]);
  });

  it('shows invalid text as is, hiding nothing', () => {
    expect(renderCloze('{{c1::open', 1, 'front')).toEqual([{ kind: 'text', text: '{{c1::open' }]);
    expect(renderCloze('', 1, 'front')).toEqual([]);
  });
});
