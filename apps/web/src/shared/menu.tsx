import type { RulesSnapshot } from '@qroove/contracts';
import { BRAND, genresOf } from '@qroove/config';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ConnectionBadge } from '../attendee/ConnectionBadge';
import { GenreDot, StyleSwatches } from './Genre';
import type { Connection } from './useEventStream';
import { ThemeToggle } from './ThemeToggle';

interface HeaderEvent {
  rules: RulesSnapshot | null;
  name: string | null;
  connection: Connection | null;
}
const NO_EVENT: HeaderEvent = { rules: null, name: null, connection: null };
const RulesCtx = createContext<{
  event: HeaderEvent;
  setEvent: (e: HeaderEvent) => void;
}>({ event: NO_EVENT, setEvent: () => {} });

export function MenuProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<HeaderEvent>(NO_EVENT);
  return <RulesCtx.Provider value={{ event, setEvent }}>{children}</RulesCtx.Provider>;
}

/** "Mango Octopus Rye" -> "mango-octopus-rye". */
export const nameToken = (name: string) => name.trim().toLowerCase().split(/\s+/).join('-');

/** "ABC-123": shown as it is, big enough to read out across a room. */
const isRoomCode = (name: string) => /^[0-9A-Z]{3}-[0-9A-Z]{3}$/.test(name);

/** Pages with an event publish its rules and name here, for the header menu and the header name. */
export function useMenuRules(
  rules: RulesSnapshot | null | undefined,
  name?: string | null | undefined,
  connection?: Connection | undefined,
) {
  const { setEvent } = useContext(RulesCtx);
  useEffect(() => {
    setEvent({ rules: rules ?? null, name: name ?? null, connection: connection ?? null });
    return () => setEvent(NO_EVENT);
  }, [rules, name, connection, setEvent]);
}

/** The event's name in the header: small, lower-case, hyphenated, and plainly not a control. */
export function HeaderEventName() {
  const { event } = useContext(RulesCtx);
  if (!event.name) return <span className="topbar-spacer" />;
  return (
    <div className="event-token">
      <span aria-hidden="true" className={isRoomCode(event.name) ? 'room-code-chip' : undefined}>
        {isRoomCode(event.name) ? event.name : nameToken(event.name)}
      </span>
      {event.connection ? <ConnectionBadge connection={event.connection} /> : null}
    </div>
  );
}

export function RulesList({ rules }: { rules: RulesSnapshot }) {
  const single = rules.segments.length === 1;
  return (
    <ul className="rules-list">
      {rules.segments.map((seg, i) => {
        const genres = genresOf(seg.enabledStyles);
        return (
          <li key={i}>
            {single ? null : <strong>{i + 1}. </strong>}
            <StyleSwatches styles={seg.enabledStyles} size={16} />{' '}
            {genres.map((g) => (
              <span key={g} className="cap">
                <GenreDot genre={g} size={12} />×{seg.runCaps[g]}
              </span>
            ))}
          </li>
        );
      })}
      <li>
        <strong>{rules.submissionLimit}</strong> songs each
      </li>
    </ul>
  );
}

const Burger = () => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

/** Top-right controls: the sun/moon toggle and the three-line menu (Docs, Privacy, Source; rules on event pages). */
export function AppMenu() {
  const {
    event: { rules },
  } = useContext(RulesCtx);
  const [open, setOpen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return (
    <div className="menu">
      <ThemeToggle />
      <button
        type="button"
        className="btn ghost icon-btn"
        aria-label="Menu"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="app-menu"
        onClick={() => setOpen(!open)}
      >
        <Burger />
      </button>
      {open ? (
        <div id="app-menu" className="menu-panel card" role="group" aria-label="Menu">
          {rules ? (
            <div>
              <button
                type="button"
                className="btn ghost"
                aria-expanded={showRules}
                onClick={() => setShowRules(!showRules)}
              >
                Session rules {showRules ? '▴' : '▾'}
              </button>
              {showRules ? <RulesList rules={rules} /> : null}
            </div>
          ) : null}
          <a href={BRAND.docsPath} className="btn ghost">
            Docs
          </a>
          <Link to="/privacy" className="btn ghost" onClick={() => setOpen(false)}>
            Privacy
          </Link>
          <a href={BRAND.repoUrl} className="btn ghost" rel="noopener">
            Source
          </a>
        </div>
      ) : null}
    </div>
  );
}
