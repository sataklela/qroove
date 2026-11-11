import { useRef, useState, type ReactNode } from 'react';

const THRESHOLD = 0.35; // share of the row's width a swipe must cover to count
const SLOP = 8; // px of sideways movement before a touch is a swipe

/**
 * A queue row. With `onRemove`, swiping it to the left removes the song in one gesture (the red bin
 * shows how far there is to go). The ✕ button does the same in two taps, for anyone who does not
 * swipe: keyboard, switch and screen-reader users.
 */
export function SwipeRow({
  children,
  onRemove,
  removeLabel,
  className = '',
}: {
  children: ReactNode;
  onRemove?: (() => void) | undefined;
  /** What the ✕ button removes, e.g. "Remove La Vida". */
  removeLabel?: string;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [width, setWidth] = useState(300);
  const touch = useRef<{ x: number; y: number; width: number; active: boolean } | null>(null);
  if (!onRemove) return <li className={`qrow ${className}`}>{children}</li>;

  const remove = () => {
    setLeaving(true);
    onRemove();
  };
  return (
    <li className={`qrow swipe ${className}${leaving ? ' leaving' : ''}`}>
      <div
        className="qrow-bin"
        style={{ opacity: Math.min(1, -dx / (width * THRESHOLD)) }}
        aria-hidden="true"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div
        className="qrow-fg"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dx ? 'none' : 'transform 0.2s ease',
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const w = e.currentTarget.getBoundingClientRect().width || 300;
          touch.current = { x: e.clientX, y: e.clientY, width: w, active: false };
          setWidth(w);
        }}
        onPointerMove={(e) => {
          const t = touch.current;
          if (!t) return;
          const d = e.clientX - t.x;
          if (!t.active) {
            if (Math.abs(d) < SLOP || Math.abs(e.clientY - t.y) > Math.abs(d)) return;
            t.active = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }
          setDx(Math.min(0, d));
        }}
        onPointerUp={() => {
          const t = touch.current;
          touch.current = null;
          const far = t !== null && dx <= -t.width * THRESHOLD;
          setDx(0);
          if (far) remove();
        }}
        onPointerCancel={() => {
          touch.current = null;
          setDx(0);
        }}
      >
        <div className="qrow-body">{children}</div>
        {asking ? (
          <button
            type="button"
            className="btn danger qrow-x"
            autoFocus
            onBlur={() => setAsking(false)}
            onClick={remove}
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            className="qrow-x"
            aria-label={removeLabel ?? 'Remove'}
            onClick={() => setAsking(true)}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}
