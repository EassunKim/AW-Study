// A page that shows the slide viewer on its own (/viewer-demo.html), until the lecture screens use
// it (#26). Pick a PDF from this device; nothing is stored or sent anywhere. The browser tests drive
// it. Optional address parameters: ?page=5&first=3&last=8 (open at slide 5, section 3–8).
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from '../brand';
import { extractPageText } from './pdf';
import { SlideViewer, type SlideRange } from './SlideViewer';
import '../app.css';
import './demo.css';

function Demo() {
  const params = new URLSearchParams(location.search);
  const number = (name: string) => {
    const n = Number(params.get(name));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const first = number('first');
  const last = number('last');
  const range: SlideRange | undefined = first && last ? { first, last } : undefined;
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [changes, setChanges] = useState<number[]>([]);
  const [text, setText] = useState<string[] | null>(null);
  // Controlled, as the lecture screens will use it: the viewer reports moves, and we pass the page back
  const [page, setPage] = useState(number('page') ?? 1);

  return (
    <main className="viewer-demo">
      <h1>
        {APP_NAME}: slide viewer <span className="muted small">(test page)</span>
      </h1>
      <p className="muted small">The PDF stays on this device: nothing is stored or sent.</p>
      <div className="row">
        <label htmlFor="pdf-file">PDF file</label>
        <input
          id="pdf-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setText(null);
            setChanges([]);
            setPage(number('page') ?? 1);
            setPdf(file ? new Uint8Array(await file.arrayBuffer()) : null);
          }}
        />
        {pdf && (
          <button type="button" onClick={async () => setText(await extractPageText(pdf))}>
            Extract the text
          </button>
        )}
        {pdf && range && (
          <button type="button" onClick={() => setPage(range.first)}>
            Go to the section’s first slide
          </button>
        )}
      </div>
      {pdf && (
        <div className="viewer-demo-frame">
          <SlideViewer
            pdf={pdf}
            page={page}
            range={range}
            onPageChange={(n) => {
              setPage(n);
              setChanges((c) => [...c, n]);
            }}
          />
        </div>
      )}
      <p className="muted small" data-testid="page-changes">
        Moved to: {changes.join(', ') || 'nothing yet'}
      </p>
      {text && (
        <ol data-testid="page-text">
          {text.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
