import { NAME_WORDS } from '@qroove/config';

const VEG: readonly string[] = NAME_WORDS.vegetable;
const SEA: readonly string[] = NAME_WORDS.sea;
/** Every vegetable + sea animal pair. */
export const CODENAME_COUNT = VEG.length * SEA.length;

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** "Carrot Octopus"; past the pair space a number is added ("Carrot Octopus 2"). */
export function codename(index: number): string {
  const pair = index % CODENAME_COUNT;
  const round = Math.floor(index / CODENAME_COUNT);
  const name = `${cap(VEG[Math.floor(pair / SEA.length)]!)} ${cap(SEA[pair % SEA.length]!)}`;
  return round === 0 ? name : `${name} ${round + 1}`;
}

/**
 * Guests never type a name (ADR 0026): each gets a two-word codename, one vegetable and one sea
 * animal, unique within the event so they can tell the organiser who they are. Pure: picks a random
 * unused index, walking forward from it once most are taken.
 */
export function pickCodename(taken: readonly number[], rand: () => number): number {
  const used = new Set(taken);
  const round = Math.floor(used.size / CODENAME_COUNT);
  const base = round * CODENAME_COUNT;
  const start = Math.floor(rand() * CODENAME_COUNT);
  for (let step = 0; step < CODENAME_COUNT; step++) {
    const i = base + ((start + step) % CODENAME_COUNT);
    if (!used.has(i)) return i;
  }
  return base + CODENAME_COUNT + start;
}
