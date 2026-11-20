// The Tasks page's "nothing today" picture (docs/design/README.md): a happy, studious penguin with a
// mortarboard and an open book. Colours come from CSS (.penguin parts in app.css), so it follows the
// theme; no style attributes (the CSP forbids them).
export function Penguin() {
  return (
    <svg className="penguin" viewBox="0 0 200 200" role="img" aria-label="A happy penguin reading a book" data-testid="penguin">
      {/* shadow */}
      <ellipse className="penguin-shadow" cx="100" cy="186" rx="58" ry="7" />
      {/* feet */}
      <ellipse className="penguin-beak" cx="80" cy="180" rx="15" ry="6" />
      <ellipse className="penguin-beak" cx="120" cy="180" rx="15" ry="6" />
      {/* body and belly */}
      <path className="penguin-dark" d="M100 40c-36 0-54 34-54 76 0 36 20 64 54 64s54-28 54-64c0-42-18-76-54-76z" />
      <path className="penguin-light" d="M100 72c-22 0-34 22-34 48 0 30 14 50 34 50s34-20 34-50c0-26-12-48-34-48z" />
      {/* eyes, closed and smiling */}
      <path className="penguin-line" d="M82 92q6-7 12 0M106 92q6-7 12 0" />
      {/* cheeks */}
      <circle className="penguin-cheek" cx="78" cy="104" r="5" />
      <circle className="penguin-cheek" cx="122" cy="104" r="5" />
      {/* beak */}
      <path className="penguin-beak" d="M92 102h16l-8 9z" />
      {/* mortarboard */}
      <path className="penguin-dark" d="M70 44l30-14 30 14-30 14z" />
      <rect className="penguin-dark" x="84" y="46" width="32" height="10" rx="3" />
      <path className="penguin-tassel" d="M130 44v18" />
      <circle className="penguin-accent" cx="130" cy="64" r="3.5" />
      {/* open book held in the flippers */}
      <path className="penguin-page" d="M100 136c-12-6-26-7-38-4v32c12-3 26-2 38 4z" />
      <path className="penguin-page" d="M100 136c12-6 26-7 38-4v32c-12-3-26-2-38 4z" />
      <path className="penguin-line thin" d="M70 142c8-1 16 0 22 3M70 150c8-1 16 0 22 3M108 145c6-3 14-4 22-3M108 153c6-3 14-4 22-3" />
      <path className="penguin-cover" d="M100 136v32" />
      {/* flippers over the book's edges */}
      <path className="penguin-dark" d="M50 128c-6 14-4 28 8 36 6-4 8-14 6-24z" />
      <path className="penguin-dark" d="M150 128c6 14 4 28-8 36-6-4-8-14-6-24z" />
    </svg>
  );
}
