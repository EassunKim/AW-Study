// Text that may hold maths (src/quiz/math.ts): plain parts are React text, maths parts are drawn by
// KaTeX (MIT). KaTeX runs with `trust: false`, so LaTeX from the AI can't add links, HTML or styles of
// its own, and with `throwOnError: false`, so a typo shows as red source instead of breaking the page.
// katex.render builds DOM nodes and sets their sizes through element.style, which our CSP allows
// (style-src 'self' only blocks style written into HTML). Its fonts come from our own site.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { splitMath } from '../quiz/math';

export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => splitMath(text), [text]);
  return (
    <>
      {parts.map((part, i) => (part.kind === 'text' ? <span key={i}>{part.text}</span> : <Formula key={i} tex={part.tex} display={part.display} />))}
    </>
  );
}

function Formula({ tex, display }: { tex: string; display: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    katex.render(tex, ref.current, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxSize: 10,
      maxExpand: 200,
      output: 'htmlAndMathml', // MathML for screen readers, beside what's drawn
    });
  }, [tex, display]);
  return <span ref={ref} className={display ? 'math display' : 'math'} data-testid="math" />;
}
