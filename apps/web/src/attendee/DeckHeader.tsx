import type { EventPublicView } from '@qroove/contracts';
import type { Connection } from '../shared/useEventStream';

type Tone = 'live' | 'warn' | 'idle' | 'down';

/** What the pill says, from the real event state and the state of the connection to the server. */
export function deckStatus(
  view: Pick<EventPublicView, 'state' | 'breaks'>,
  connection: Connection,
): { text: string; tone: Tone } {
  if (connection === 'offline') return { text: 'Offline', tone: 'down' };
  if (connection === 'reconnecting') return { text: 'Reconnecting', tone: 'warn' };
  switch (view.state) {
    case 'ACTIVE': {
      const onBreak = view.breaks.some((b) => b.actualStart !== null && b.actualEnd === null);
      return onBreak ? { text: 'On a break', tone: 'warn' } : { text: 'Live', tone: 'live' };
    }
    case 'PAUSED':
    case 'TRANSFERRING':
      return { text: 'Paused', tone: 'warn' };
    case 'DRAFT':
      return { text: 'Not started', tone: 'idle' };
    default:
      return { text: 'Ended', tone: 'idle' };
  }
}

/** The brand mark, what this screen is, and whether the event is really live right now. */
export function DeckHeader({
  view,
  connection,
  codename,
}: {
  view: EventPublicView;
  connection: Connection;
  /** The person's own codename at this event, once they have joined. */
  codename: string | null;
}) {
  const status = deckStatus(view, connection);
  return (
    <header className="deck-head">
      <h1 className="sr-only">{view.name}</h1>
      <div className="deck-brand">
        <span className="logo-badge" aria-hidden="true">
          Q
        </span>
        <span className="deck-label">
          {codename ? (
            <>
              You are <strong className="codename">{codename}</strong>
            </>
          ) : (
            'Live request deck'
          )}
        </span>
      </div>
      <span className={`status-pill ${status.tone}`} role="status">
        <span className="live-dot" aria-hidden="true" />
        {status.text}
      </span>
    </header>
  );
}
