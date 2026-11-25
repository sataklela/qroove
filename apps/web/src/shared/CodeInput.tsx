import { Fragment, useRef } from 'react';

const ALPHABET = /[A-Za-z0-9]/;

/**
 * One box per character with auto-advance, backspace-to-previous and paste-to-fill, like the
 * one-time-code fields people already know. Calls `onComplete` when the last box is filled.
 */
export function CodeInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  label = 'Event code',
  groupSize,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  label?: string;
  /** Show a hyphen after every `groupSize` boxes (a 6-character code reads as ABC-123). */
  groupSize?: number;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? '');

  function commit(next: string, focusIndex: number) {
    const v = next.slice(0, length);
    onChange(v);
    refs.current[Math.min(focusIndex, length - 1)]?.focus();
    if (v.length === length) onComplete?.(v);
  }

  function fill(from: number, text: string) {
    const clean = [...text]
      .filter((c) => ALPHABET.test(c))
      .join('')
      .toUpperCase();
    if (!clean) return;
    const head = value.slice(0, from).padEnd(from, ' ').replace(/ /g, '');
    commit(head + clean, from + clean.length);
  }

  return (
    <div role="group" aria-label={label} className="code-input">
      {chars.map((c, i) => (
        <Fragment key={i}>
          {groupSize && i > 0 && i % groupSize === 0 ? (
            <span className="code-sep" aria-hidden="true">
              -
            </span>
          ) : null}
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="code-box"
            value={c}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={2}
            disabled={disabled}
            aria-label={`${label}, character ${i + 1} of ${length}`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => fill(i, e.target.value.slice(-1) || e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              fill(i, e.clipboardData.getData('text'));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace') {
                e.preventDefault();
                if (c) onChange(value.slice(0, i) + value.slice(i + 1));
                else if (i > 0) {
                  onChange(value.slice(0, i - 1) + value.slice(i));
                  refs.current[i - 1]?.focus();
                }
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                // Moves between the boxes; at either end the key is left to TV remote navigation.
                const next = refs.current[i + (e.key === 'ArrowLeft' ? -1 : 1)];
                if (next) {
                  e.preventDefault();
                  next.focus();
                }
              }
            }}
          />
        </Fragment>
      ))}
    </div>
  );
}
