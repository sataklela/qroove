import type { GenreId } from './styles.js';

/**
 * Radio fallback (ADR 0023). The browser on the organiser's device plays a station's public listener
 * URL directly; this server never relays audio. Station entries are non-secret and only `enabled`
 * after the stream and its metadata were tested without credentials (see `verifiedNote`).
 */
export interface RadioStation {
  id: string;
  name: string;
  genre: GenreId;
  /** Direct HTTPS listener URL, played by an <audio> element. */
  streamUrl: string;
  provider: 'radio.co';
  /** Radio.co station id, for the public status endpoint. */
  providerStationId: string;
  siteUrl: string;
  enabled: boolean;
  /** Evidence for `enabled`, or the reason it is off. */
  verifiedNote: string;
}

export const RADIO_STATIONS: readonly RadioStation[] = [
  {
    id: 'bachata-sensual-radio',
    name: 'Bachata Sensual Radio',
    genre: 'bachata',
    streamUrl: 'https://s3.radio.co/sb45e5e8de/listen',
    provider: 'radio.co',
    providerStationId: 'sb45e5e8de',
    siteUrl: 'https://bachatasensualradio.com/',
    enabled: true,
    verifiedNote:
      '2026-11-05: its own player uses this stream (audio/mpeg, 96 kbit/s, CORS *); ' +
      'https://public.radio.co/stations/sb45e5e8de/status answers unauthenticated with CORS *. ' +
      'Tracks are often hour-long DJ mixes. Not yet tried on iOS or Android.',
  },
  {
    id: 'salsaviva-live365',
    name: 'SalsaViva',
    genre: 'salsa',
    streamUrl: 'https://streaming.live365.com/a37497',
    provider: 'radio.co',
    providerStationId: '',
    siteUrl: 'https://salsaviva.fm/',
    enabled: false,
    verifiedNote:
      '2026-11-05: the stream URL redirects to a Live365 edge that answers 401 without credentials ' +
      'from the test machine, and no public metadata endpoint was found. Left off.',
  },
];

export const RADIO_DEFAULTS = {
  /** Off until the real-device checks in the plan have been done; the organiser can switch it on. */
  enabledByDefault: false,
  /** First choice first. Event rules still decide which genres are allowed. */
  genrePriority: ['salsa', 'bachata', 'other', 'chacha'] as readonly GenreId[],
  statusPollMs: 10_000,
  /** The metadata is considered stale (warning only) when it has not answered for this long. */
  metadataStaleMs: 45_000,
  /** A queued song waits at most this long for the radio track to end, then takes over. */
  maxQueueWaitMs: 5 * 60_000,
  /** A failing station is not tried again for this long. */
  failureBackoffMs: 60_000,
} as const;

export const radioStation = (id: string): RadioStation | undefined =>
  RADIO_STATIONS.find((s) => s.id === id);

export interface RadioChoiceInput {
  /** Genres the event allows right now. */
  allowedGenres: readonly GenreId[];
  /** Genre of the last song played and how many in a row, from the event history. */
  lastGenre: GenreId | null;
  runLength: number;
  runCap: number;
  /** Station ids to skip (recent failures, organiser rejections). */
  unavailable?: ReadonlySet<string>;
  stations?: readonly RadioStation[];
}

/**
 * Picks the station to play when the queue has nothing eligible: the highest-priority allowed genre
 * that has a working station. Radio never extends a same-genre run, so a genre that has just
 * reached its cap is tried last (it would still be playable, but the room would hear it again).
 */
export function chooseRadioStation(i: RadioChoiceInput): RadioStation | null {
  const stations = i.stations ?? RADIO_STATIONS;
  const usable = (g: GenreId) =>
    stations.find(
      (s) =>
        s.enabled &&
        s.genre === g &&
        !i.unavailable?.has(s.id) &&
        s.streamUrl.startsWith('https://'),
    );
  const capped = i.lastGenre !== null && i.runLength >= i.runCap ? i.lastGenre : null;
  const ordered = RADIO_DEFAULTS.genrePriority.filter((g) => i.allowedGenres.includes(g));
  const sorted = [...ordered.filter((g) => g !== capped), ...ordered.filter((g) => g === capped)];
  for (const g of sorted) {
    const s = usable(g);
    if (s) return s;
  }
  return null;
}
