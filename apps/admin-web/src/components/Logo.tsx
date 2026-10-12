/**
 * The RESTOR wordmark.
 *
 * Inline rather than an <img>: the "ESTOR" letters are SVG text set in Sora,
 * and an SVG loaded as an image cannot reach the page's web fonts — it would
 * fall back to whatever sans-serif the OS has. Inline, it uses the Sora subset
 * `index.html` loads. The dark strokes follow `currentColor`, so one component
 * serves the dark sidebar and the light login card; the orange stroke is the
 * brand and never changes.
 */
export function Logo({ height = 26, className }: { height?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 457 103"
      height={height}
      width={(height * 457) / 103}
      role="img"
      aria-label="RESTOR"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <g transform="translate(16,16) scale(1.9466666666666665) translate(-8,-6)">
        <rect x="8" y="6" width="8" height="36" fill="currentColor" />
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M19 6H28A11 11 0 0 1 28 28H19ZM19 14H28A3 3 0 0 1 28 20H19Z"
        />
        <path fill="#FF6B00" d="M22 31H31L40 42H31Z" />
      </g>
      <text
        x="85.01"
        y="86.08"
        fontFamily="Sora, Inter, sans-serif"
        fontWeight={700}
        fontSize={96}
        letterSpacing={6.72}
        fill="currentColor"
      >
        ESTOR
      </text>
    </svg>
  );
}
