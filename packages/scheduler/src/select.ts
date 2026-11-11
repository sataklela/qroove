import { checkEligibility, runCapFor } from './eligibility.js';
import type {
  Candidate,
  EligibilityContext,
  HistoryState,
  Ineligibility,
  SchedulerRules,
} from './types.js';

export interface Selection {
  pick: Candidate | null;
  reason: string;
  blocked: Array<{ requestId: string; reason: Ineligibility }>;
}

const byAge = (a: Candidate, b: Candidate) =>
  (a.priority ?? 0) - (b.priority ?? 0) ||
  a.acceptedSeq - b.acceptedSeq ||
  (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0);

/** SPEC §3.7 comparator. Pure and independent of input order. */
export function selectNext(
  candidates: readonly Candidate[],
  history: HistoryState,
  rules: SchedulerRules,
  ctx: EligibilityContext = {},
): Selection {
  const blocked: Selection['blocked'] = [];
  const poolKeys = new Set(candidates.map((c) => c.canonicalKey));
  const ectx = { ...ctx, poolKeys };
  const eligibleByStyle = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const e = checkEligibility(c, history, rules, ectx);
    if (e.ok) {
      const list = eligibleByStyle.get(c.style) ?? [];
      list.push(c);
      eligibleByStyle.set(c.style, list);
    } else blocked.push({ requestId: c.requestId, reason: e.reason });
  }
  blocked.sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0));

  if (candidates.length === 0) return { pick: null, reason: 'NO_CANDIDATES', blocked };
  if (eligibleByStyle.size === 0) {
    return { pick: null, reason: `ALL_BLOCKED_FAIRNESS: ${summarise(blocked)}`, blocked };
  }

  const heads = [...eligibleByStyle.entries()].map(([style, list]) => ({
    style,
    head: [...list].sort(byAge)[0]!,
  }));
  heads.sort(
    (a, b) =>
      (a.head.priority ?? 0) - (b.head.priority ?? 0) ||
      a.head.acceptedSeq - b.head.acceptedSeq ||
      Number(a.style === history.lastStyle) - Number(b.style === history.lastStyle) ||
      (a.style < b.style ? -1 : a.style > b.style ? 1 : 0) ||
      byAge(a.head, b.head),
  );
  const chosen = heads[0]!;
  const notes: string[] = [];
  if (history.lastStyle !== null) {
    const cap = runCapFor(rules, history.lastStyle);
    if (history.runLength >= cap)
      notes.push(`${label(history.lastStyle)} at run cap ${history.runLength}/${cap}`);
  }
  const reason = [`Oldest eligible ${label(chosen.style)}`, ...notes].join('; ');
  return { pick: chosen.head, reason, blocked };
}

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function summarise(blocked: Selection['blocked']): string {
  const reasons = new Set(blocked.map((b) => b.reason));
  if (reasons.has('STYLE_DISABLED')) return 'Waiting for its part of the evening';
  if (reasons.has('NOT_PLAYABLE')) return 'Waiting for a playable source';
  if (reasons.has('RUN_CAP'))
    return 'Waiting for a different genre. Add one to keep the music going';
  return 'No eligible song right now';
}
