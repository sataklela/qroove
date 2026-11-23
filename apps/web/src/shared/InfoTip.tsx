import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * Explanations live behind an (i): the screen shows icons and a few words, and anyone who wants
 * the detail taps for it. Works the same on the site and in the app.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="info-tip">
      <summary aria-label={label} title={label}>
        <Info aria-hidden size={18} />
      </summary>
      <div className="info-tip-body muted small">{children}</div>
    </details>
  );
}
