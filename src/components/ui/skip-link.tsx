/** The first thing a keyboard user reaches: jumps past the header to the page's <main id="main">. */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:shadow-card"
    >
      {label}
    </a>
  );
}
