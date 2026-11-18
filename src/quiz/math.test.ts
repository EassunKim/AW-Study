import { describe, expect, it } from 'vitest';
import { plainMath, splitMath } from './math';

describe('splitMath', () => {
  it('finds maths between \\( \\) and \\[ \\], leaving the rest plain', () => {
    expect(splitMath('The rule \\(\\int u\\,dv = uv - \\int v\\,du\\) holds.')).toEqual([
      { kind: 'text', text: 'The rule ' },
      { kind: 'math', tex: '\\int u\\,dv = uv - \\int v\\,du', display: false },
      { kind: 'text', text: ' holds.' },
    ]);
    expect(splitMath('\\[ x^2 \\]')).toEqual([{ kind: 'math', tex: 'x^2', display: true }]);
    expect(splitMath('\\(a\\) and \\(b\\)').map((p) => p.kind)).toEqual(['math', 'text', 'math']);
  });

  it('leaves dollars, unclosed or empty markers, and runaway maths as plain text', () => {
    expect(splitMath('It costs $5 and $6.')).toEqual([{ kind: 'text', text: 'It costs $5 and $6.' }]);
    expect(splitMath('Open \\( never closed')).toEqual([{ kind: 'text', text: 'Open \\( never closed' }]);
    expect(splitMath('Empty \\(\\) here')).toEqual([{ kind: 'text', text: 'Empty \\(\\) here' }]);
    const long = `\\(${'x'.repeat(1_001)}\\)`;
    expect(splitMath(long)).toEqual([{ kind: 'text', text: long }]);
    expect(splitMath('')).toEqual([]);
  });

  it('plainMath drops the markers', () => {
    expect(plainMath('Find \\(x^2\\) now')).toBe('Find x^2 now');
  });
});
