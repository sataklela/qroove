import { useId, useRef, useState, type ReactNode } from 'react';

type Tab = 'queue' | 'mine';

/** A sideways swipe must be long and mostly horizontal, so scrolling the page never switches tabs. */
const SWIPE_PX = 60;

/**
 * Two views of the same queue: the whole queue (the default) and the person's own songs one swipe
 * to the right. Only the open tab is drawn; the tab buttons work for anyone who does not swipe.
 */
export function QueueTabs({
  queue,
  mine,
  mineCount,
}: {
  queue: ReactNode;
  mine: ReactNode;
  mineCount: number;
}) {
  const [tab, setTab] = useState<Tab>('queue');
  const id = useId();
  const start = useRef<{ x: number; y: number } | null>(null);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'queue', label: 'Queue' },
    { key: 'mine', label: `My songs (${mineCount})` },
  ];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') setTab('mine');
    else if (e.key === 'ArrowLeft') setTab('queue');
  }

  return (
    <div
      className="queue-tabs"
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const s = start.current;
        const t = e.changedTouches[0];
        start.current = null;
        if (!s || !t) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // Swiping right-to-left reveals the tab on the right; the other way goes back.
        setTab(dx < 0 ? 'mine' : 'queue');
      }}
    >
      <div className="tab-bar" role="tablist" aria-label="Queue views" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${id}-${t.key}-tab`}
            aria-selected={tab === t.key}
            aria-controls={`${id}-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className={`tab${tab === t.key ? ' on' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        key={tab}
        className="tab-panel swap-in"
        role="tabpanel"
        id={`${id}-${tab}`}
        aria-labelledby={`${id}-${tab}-tab`}
      >
        {tab === 'queue' ? queue : mine}
      </div>
    </div>
  );
}
