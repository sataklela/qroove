import type { AdminState, CreateEventBody, ExportSnapshot, SettingsBody } from '@qroove/contracts';
import { request } from '../shared/api';

export interface Created {
  eventId: string;
  slug: string;
  name: string;
  /** Carries the QR secret: never display it as text. */
  joinUrl: string;
  seeded?: number;
  adminUrl: string;
  recoverySecret: string;
}

export interface AdminStateResponse extends AdminState {
  csrf: string;
}

const base = (id: string) => `/api/events/${id}`;

export const adminApi = {
  create: (body: CreateEventBody) => request<Created>('POST', '/api/events', { body }),
  /** Exchanges the fragment secret for the HttpOnly cookie. */
  session: (id: string, secret: string) =>
    request<{ ok: true; csrf: string }>('POST', `${base(id)}/admin/session`, { body: { secret } }),
  claim: (id: string, code: string) =>
    request<{ ok: true; csrf: string }>('POST', `${base(id)}/admin/handover/claim`, {
      body: { code },
    }),
  recover: (id: string, recoverySecret: string) =>
    request<{ ok: true; csrf: string }>('POST', `${base(id)}/admin/recover`, {
      body: { recoverySecret },
    }),
  state: (id: string, signal?: AbortSignal) =>
    request<AdminStateResponse>('GET', `${base(id)}/admin/state`, signal ? { signal } : {}),
  carryOver: (id: string) => request<ExportSnapshot>('GET', `${base(id)}/admin/carry-over`),
  exportSnapshot: (id: string) => request<ExportSnapshot>('GET', `${base(id)}/export`),
  importSnapshot: (body: {
    snapshot: ExportSnapshot;
    timezone: string;
    shuffle: boolean;
    selectedIndexes: number[];
    name: string;
    plannedDurationMin: number;
  }) => request<Created & { seeded: number }>('POST', '/api/events/import', { body }),
};

/** A command bound to one event and CSRF token. */
export function commands(id: string, csrf: string) {
  const post = <T = { ok: true; version: number }>(path: string, body: unknown = {}) =>
    request<T>('POST', `${base(id)}${path}`, { body, csrf });
  return {
    start: () => post('/start'),
    pause: () => post('/admin/pause'),
    resume: () => post('/admin/resume'),
    skip: () => post('/admin/skip'),
    end: () => post('/admin/end'),
    extend: (endAt: number) => post('/admin/end-time', { endAt }),
    /** Time, genres, songs in a row, songs per person, guests first: also while music plays. */
    settings: (body: SettingsBody) => post('/admin/settings', body),
    remove: (rid: string) => post(`/admin/remove/${rid}`),
    duplicate: (rid: string, decision: 'approve' | 'reject') =>
      post(`/admin/duplicate/${rid}`, { decision }),
    startBreak: (bid: string) => post(`/admin/breaks/${bid}/start`),
    endBreak: (bid: string) => post(`/admin/breaks/${bid}/end`),
    handover: () => post<{ code: string; expiresAt: number }>('/admin/handover'),
  };
}
export type Commands = ReturnType<typeof commands>;

export interface LeaseCreds {
  leaseToken: string;
  epoch: number;
}

const player = (id: string) => `/api/events/${id}/player`;

/** Player calls are authorised by the lease token (claim needs the admin cookie). */
export const playerApi = {
  claim: (id: string, csrf: string, takeover: boolean) =>
    request<{ leaseToken: string; lease: { epoch: number; expiresAt: number } }>(
      'POST',
      `${player(id)}/claim`,
      { body: { takeover }, csrf },
    ),
  heartbeat: (id: string, l: LeaseCreds) =>
    request<{ ok?: true }>('POST', `${player(id)}/heartbeat`, { body: l }),
  started: (id: string, l: LeaseCreds, requestId: string, durationMs: number | null) =>
    request<{ ok: true }>('POST', `${player(id)}/started`, {
      body: { ...l, requestId, ...(durationMs ? { durationMs: Math.round(durationMs) } : {}) },
    }),
  finished: (id: string, l: LeaseCreds, requestId: string, outcome: 'PLAYED' | 'FAILED') =>
    request<{ ok: true }>('POST', `${player(id)}/finished`, { body: { ...l, requestId, outcome } }),
  /** YouTube videos that are the same recording as a Spotify song, best first (may be empty). */
  youtube: (id: string, requestId: string) =>
    request<{ videoIds: string[] }>('GET', `${player(id)}/youtube/${requestId}`),
  radioStarted: (
    id: string,
    l: LeaseCreds,
    stationId: string,
    trackKey: string,
    title: string | null,
  ) =>
    request<{ ok: true }>('POST', `${player(id)}/radio/started`, {
      body: { ...l, stationId, trackKey, title },
    }),
  radioEnded: (id: string, l: LeaseCreds) =>
    request<{ ok: true }>('POST', `${player(id)}/radio/ended`, { body: l }),
  release: (id: string, l: LeaseCreds) =>
    request<{ ok: true }>('POST', `${player(id)}/release`, { body: l }),
};

/** `/a/:id#k=…` for a freshly created event: the entry route signs in and removes the secret. */
export function organiserPath(c: Pick<Created, 'adminUrl'>): string {
  const u = new URL(c.adminUrl);
  return `${u.pathname}${u.hash}`;
}

/** The organiser's switch for the radio fallback (ADR 0023). */
export const setRadioFallback = (id: string, csrf: string, enabled: boolean) =>
  request<{ ok: true }>('POST', `/api/events/${id}/admin/radio`, { body: { enabled }, csrf });
