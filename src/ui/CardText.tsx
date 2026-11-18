// Card text on screen. Everything is rendered as React text, never as HTML, so whatever a card
// contains (including "<script>") shows as typed. Line breaks are kept by CSS (white-space).
import type { ClozeSegment } from '../types/study';

export function PlainText({ text, className }: { text: string; className?: string }) {
  return <div className={`card-text ${className ?? ''}`}>{text}</div>;
}

export function ClozeText({ segments, className }: { segments: ClozeSegment[]; className?: string }) {
  return (
    <div className={`card-text ${className ?? ''}`}>
      {segments.map((segment, i) => {
        switch (segment.kind) {
          case 'text':
            return <span key={i}>{segment.text}</span>;
          case 'blank':
            return (
              <span key={i} className="cloze-blank" data-testid="cloze-blank">
                [{segment.hint ?? '…'}]
              </span>
            );
          case 'answer':
            return (
              <span key={i} className="cloze-answer" data-testid="cloze-answer">
                {segment.text}
              </span>
            );
        }
      })}
    </div>
  );
}
