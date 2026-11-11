import {
  AdminSessionBody,
  CreateEventBody,
  DomainError,
  DuplicateDecisionBody,
  EndTimeBody,
  HandoverClaimBody,
  ImportBody,
  JoinBody,
  PlayerClaimBody,
  PlayerFinishedBody,
  PlayerHeartbeatBody,
  PlayerRadioStartedBody,
  PlayerReleaseBody,
  RadioSettingBody,
  PlayerStartedBody,
  RecoverBody,
  RemoveBody,
  ResolveLinkBody,
  SubmitRequestBody,
  UpdateDraftBody,
  SettingsBody,
  VersionedBody,
  songCoverageProblem,
  ResolvePlaylistBody,
  BatchSubmitBody,
  type ExportSnapshot,
} from '@qroove/contracts';
import {
  DEFAULT_ENABLED_STYLES,
  EVENT_LIMITS,
  RULE_DEFAULTS,
  STYLE_PRESETS,
  maxSubmissionLimit,
} from '@qroove/config';
import { parseChannelRef } from '../ingestion/providers/youtube.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as cmd from '../domain/commands/index.js';
import { SESSION_HEADROOM_MS } from '../domain/commands/import.js';
import { MAX_SEEDS, type SeedSong } from '../domain/draft.js';
import { capPlaytime } from '../ingestion/playlist.js';
import { safeSourceUrl } from '../ingestion/parseLink.js';
import { mulberry32 } from '../domain/ids.js';
import { verifyAdmin, verifyParticipant } from '../domain/queries.js';
import { HOUR, MINUTE } from '../security/rateLimit.js';
import {
  adminFromRequest,
  participantFromRequest,
  requireSameOrigin,
  setAdminSession,
} from '../security/tokens.js';
import { openStream } from '../realtime/sse.js';
import type { ApiContext } from './context.js';
import { parse } from './errors.js';
import { adminState, myRequests, publicView, requestView } from './views.js';

const Id = z.string().min(1).max(64);
const idParams = z.object({ id: Id });
const ridParams = z.object({ id: Id, rid: Id });
const bidParams = z.object({ id: Id, bid: Id });

export function registerRoutes(app: FastifyInstance, ctx: ApiContext) {
  const { deps, env, ingestion, starter, youtube, bus, sec, limiter } = ctx;
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const idemKey = (req: FastifyRequest) => {
    const k = req.headers['idempotency-key'];
    return typeof k === 'string' && k.length > 0 && k.length <= 100 ? k : undefined;
  };
  const admin = (req: FastifyRequest, id: string) => ({
    eventId: id,
    adminSecret: adminFromRequest(sec, req, id),
  });
  const unlimited = env.RATE_LIMIT_OFF === '1' && env.NODE_ENV !== 'production';
  const limit = (key: string, max: number, windowMs: number) =>
    unlimited ? undefined : limiter.check(key, max, windowMs);

  // Global per-IP budget for the whole API.
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) limit(`g:${req.ip}`, 120, MINUTE);
  });

  const agg = async (eventId: string) => {
    const a = await deps.repo.getEventPublic(eventId);
    if (!a) throw new DomainError('NOT_FOUND');
    return a;
  };

  // ---- discovery & public ------------------------------------------------------------------
  app.get('/api/events/by-slug/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(16) }), req.params);
    const e = await deps.repo.findEventBySlug(slug.toUpperCase());
    if (!e) throw new DomainError('NOT_FOUND');
    return { eventId: e.id, slug: e.publicSlug, name: e.name };
  });

  // `:id` is a slug here, per SPEC §8 (`/api/events/:slug/public`).
  app.get('/api/events/:id/public', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const e = await deps.repo.findEventBySlug(id.toUpperCase());
    if (!e) throw new DomainError('NOT_FOUND');
    reply.header('cache-control', 'no-store');
    return publicView(await agg(e.id), deps.clock.now());
  });

  app.get('/api/events/:id/stream', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await agg(id);
    await openStream(req, reply, bus, id, (a) => publicView(a, deps.clock.now()));
  });

  app.get('/api/events/:id/export', async (req) => {
    const { id } = parse(idParams, req.params);
    const a = await agg(id);
    const seen = new Set<string>();
    const recommendations: ExportSnapshot['recommendations'] = [];
    for (const r of a.requests) {
      if (['WITHDRAWN', 'REJECTED', 'UNAVAILABLE'].includes(r.state) || seen.has(r.canonicalKey))
        continue;
      seen.add(r.canonicalKey);
      recommendations.push({
        title: r.title,
        artist: r.artist,
        style: r.style,
        durationMs: r.durationMs,
        sourceUrl: r.sourceUrl,
      });
    }
    return {
      formatVersion: 1,
      name: a.event.name,
      rules: a.event.rules,
      recommendations,
    } satisfies ExportSnapshot;
  });

  // ---- link intake -------------------------------------------------------------------------
  app.post('/api/resolve-link', async (req) => {
    limit(`resolve:${req.ip}`, 20, MINUTE);
    const { url } = parse(ResolveLinkBody, req.body);
    const r = await ingestion.resolveUrl(url);
    return {
      title: r.track.title,
      artist: r.track.artist,
      durationMs: r.track.durationMs,
      artworkUrl: r.track.artworkUrl,
      provider: r.track.provider,
      confidence: r.confidence,
      suggestedStyle: r.suggestedStyle,
    };
  });

  // Public playlist page -> its songs, so a person (or an organiser) can sort them before adding.
  app.post('/api/resolve-playlist', async (req) => {
    limit(`playlist:${req.ip}`, 12, MINUTE);
    const { url } = parse(ResolvePlaylistBody, req.body);
    const pl = await ingestion.resolvePlaylist(url);
    return { tracks: pl.tracks.slice(0, MAX_SEEDS) };
  });

  // Spotify's own search: anyone can find songs without a Spotify account of their own.
  app.get('/api/spotify/search', async (req) => {
    limit(`spotify-search:${req.ip}`, 30, MINUTE);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    return { tracks: await ingestion.searchSongs(q) };
  });

  // A person's own public YouTube playlists, found from their channel link or @handle. The songs
  // themselves then load through `resolve-playlist`, exactly like a pasted playlist link.
  const UNAVAILABLE = 'YouTube would not list playlists right now. Paste a playlist link instead.';
  app.get('/api/youtube/playlists', async (req) => {
    limit(`youtube-playlists:${req.ip}`, 20, MINUTE);
    const { channel } = parse(z.object({ channel: z.string().trim().min(3).max(200) }), req.query);
    const ref = parseChannelRef(channel);
    if (!ref) {
      throw new DomainError(
        'VALIDATION',
        'That does not look like a YouTube channel. Paste your channel link or @handle.',
      );
    }
    const playlists = await youtube.channelPlaylists(ref).catch((e: unknown) => {
      if (e instanceof DomainError) throw new DomainError('METADATA_UNAVAILABLE', UNAVAILABLE);
      throw e;
    });
    if (playlists === null) throw new DomainError('METADATA_UNAVAILABLE', UNAVAILABLE);
    return { playlists };
  });

  // ---- creating events ---------------------------------------------------------------------
  const created = (r: {
    eventId: string;
    slug: string;
    name: string;
    adminSecret: string;
    recoverySecret: string;
    rules: unknown;
  }) => ({
    eventId: r.eventId,
    slug: r.slug,
    name: r.name,
    joinUrl: `${base}/e/${r.slug}`,
    // The secret lives in the fragment, which browsers never send to a server.
    adminUrl: `${base}/a/${r.eventId}#k=${r.adminSecret}`,
    recoverySecret: r.recoverySecret,
    rules: r.rules,
  });

  app.post('/api/events', async (req, reply) => {
    limit(`create:${req.ip}`, 5, HOUR);
    const { songs, starter: wantStarter, ...given } = parse(CreateEventBody, req.body);
    const maxLimit = maxSubmissionLimit(
      given.plannedDurationMin ?? EVENT_LIMITS.defaultDurationMin,
    );
    if ((given.submissionLimit ?? 0) > maxLimit) {
      throw new DomainError(
        'VALIDATION',
        `Songs per person can be at most ${maxLimit} for this planned time.`,
      );
    }
    const body = {
      ...given,
      submissionLimit: given.submissionLimit ?? Math.min(RULE_DEFAULTS.submissionLimit, maxLimit),
    };
    let seeds: SeedSong[] = [];
    if (songs?.length) {
      if (!body.plannedDurationMin) {
        throw new DomainError('VALIDATION', 'Set a planned time before adding playlist songs.');
      }
      const everywhere = new Set(
        (
          body.segments ?? [{ enabledStyles: body.enabledStyles ?? DEFAULT_ENABLED_STYLES }]
        ).flatMap((s) => s.enabledStyles),
      );
      // Keep the organiser's order, but never more than fits in the planned time minus a minute.
      seeds = capPlaytime(
        songs.map((t) => ({ ...t, sourceUrl: safeSourceUrl(t.sourceUrl) })),
        body.plannedDurationMin * 60_000 - SESSION_HEADROOM_MS,
        MAX_SEEDS,
      );
      const problem = songCoverageProblem(
        STYLE_PRESETS.filter((p) => everywhere.has(p.id)).map((p) => p.id),
        seeds.map((t) => t.style),
      );
      if (problem) throw new DomainError('VALIDATION', problem);
    }
    if (wantStarter && seeds.length === 0) {
      const styles = (
        body.segments?.[0]?.enabledStyles ??
        body.enabledStyles ??
        DEFAULT_ENABLED_STYLES
      ).slice();
      const planned = body.plannedDurationMin ?? EVENT_LIMITS.defaultDurationMin;
      seeds = await starter.pick(
        styles,
        mulberry32(deps.ids.seed()),
        planned * 60_000 - SESSION_HEADROOM_MS,
      );
    }
    const r = await cmd.createEvent(
      deps,
      // A one-tap event has a planned time even when the client sent none.
      wantStarter
        ? {
            ...body,
            plannedDurationMin: body.plannedDurationMin ?? EVENT_LIMITS.defaultDurationMin,
          }
        : body,
      { seeds },
    );
    reply.header('cache-control', 'no-store');
    return reply.code(201).send({ ...created(r), seeded: r.seeded });
  });

  app.post('/api/events/import', async (req, reply) => {
    limit(`create:${req.ip}`, 5, HOUR);
    const body = parse(
      ImportBody.extend({
        timezone: z.string().min(1).max(64),
        shuffle: z.boolean().optional(),
        name: z.string().trim().min(1).max(80).optional(),
        plannedDurationMin: z.number().int().min(15).max(480).multipleOf(15),
      }),
      req.body,
    );
    const r = await cmd.importSnapshot(deps, {
      snapshot: body.snapshot,
      timezone: body.timezone,
      plannedDurationMin: body.plannedDurationMin,
      ...(body.selectedIndexes ? { selectedIndexes: body.selectedIndexes } : {}),
      ...(body.shuffle !== undefined ? { shuffle: body.shuffle } : {}),
    });
    reply.header('cache-control', 'no-store');
    return reply.code(201).send({ ...created(r), seeded: r.seeded });
  });

  // ---- admin session -----------------------------------------------------------------------
  app.post('/api/events/:id/admin/session', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    limit(`session:${req.ip}`, 10, MINUTE);
    requireSameOrigin(sec, req);
    const { secret } = parse(AdminSessionBody, req.body);
    await verifyAdmin(deps, id, secret);
    reply.header('cache-control', 'no-store');
    return { ok: true, csrf: setAdminSession(sec, reply, id, secret) };
  });

  app.get('/api/events/:id/admin/state', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const a = admin(req, id);
    await verifyAdmin(deps, id, a.adminSecret);
    reply.header('cache-control', 'no-store');
    return {
      ...adminState(await agg(id), deps.clock.now(), base),
      csrf: sec.csrfFor(a.adminSecret),
    };
  });

  // Unplayed songs as an importable snapshot, for "create the next event from these".
  app.get('/api/events/:id/admin/carry-over', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const a = admin(req, id);
    await verifyAdmin(deps, id, a.adminSecret);
    const x = await agg(id);
    const open = new Set([
      'PENDING_METADATA',
      'QUEUED',
      'INELIGIBLE_TEMPORARILY',
      'RESERVED_NEXT',
      'OVERFLOW',
    ]);
    const seen = new Set<string>();
    const recommendations: ExportSnapshot['recommendations'] = [];
    for (const r of x.requests) {
      if (!open.has(r.state) || r.possibleDuplicate || seen.has(r.canonicalKey)) continue;
      seen.add(r.canonicalKey);
      recommendations.push({
        title: r.title,
        artist: r.artist,
        style: r.style,
        durationMs: r.durationMs,
        sourceUrl: r.sourceUrl,
      });
    }
    reply.header('cache-control', 'no-store');
    return {
      formatVersion: 1,
      name: x.event.name,
      rules: x.event.rules,
      recommendations,
    } satisfies ExportSnapshot;
  });

  app.get('/api/events/:id/admin/stream', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const a = admin(req, id);
    await verifyAdmin(deps, id, a.adminSecret);
    await openStream(req, reply, bus, id, (x) => adminState(x, deps.clock.now(), base));
  });

  // ---- admin commands ----------------------------------------------------------------------
  const versioned = (req: FastifyRequest) => parse(VersionedBody, req.body ?? {}).expectedVersion;
  const simple = (
    path: string,
    run: (
      a: ReturnType<typeof admin> & {
        expectedVersion: number | undefined;
        idempotencyKey: string | undefined;
      },
    ) => Promise<object>,
  ) =>
    app.post(path, async (req) => {
      const { id } = parse(idParams, req.params);
      return run({
        ...admin(req, id),
        expectedVersion: versioned(req),
        idempotencyKey: idemKey(req),
      });
    });

  simple('/api/events/:id/start', (a) => cmd.startEvent(deps, a));
  simple('/api/events/:id/admin/pause', (a) => cmd.pause(deps, a));
  simple('/api/events/:id/admin/resume', (a) => cmd.resume(deps, a));
  simple('/api/events/:id/admin/skip', (a) => cmd.skip(deps, a));
  simple('/api/events/:id/admin/end', (a) => cmd.endEvent(deps, a));
  simple('/api/events/:id/admin/archive', (a) => cmd.archive(deps, a));
  simple('/api/events/:id/admin/handover', (a) => cmd.createHandoverOffer(deps, a));

  app.post('/api/events/:id/admin/radio', async (req) => {
    const { id } = parse(idParams, req.params);
    const { enabled } = parse(RadioSettingBody, req.body);
    return cmd.setRadioFallback(deps, { ...admin(req, id), enabled, idempotencyKey: idemKey(req) });
  });

  app.patch('/api/events/:id/admin/draft', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(UpdateDraftBody, req.body);
    return cmd.updateDraft(deps, { ...admin(req, id), ...body });
  });

  app.post('/api/events/:id/admin/settings', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(SettingsBody, req.body);
    return cmd.updateSettings(deps, { ...admin(req, id), ...body, idempotencyKey: idemKey(req) });
  });

  app.post('/api/events/:id/admin/end-time', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(EndTimeBody, req.body);
    return cmd.setEndTime(deps, { ...admin(req, id), ...body, idempotencyKey: idemKey(req) });
  });

  app.post('/api/events/:id/admin/remove/:rid', async (req) => {
    const { id, rid } = parse(ridParams, req.params);
    const { reason } = parse(RemoveBody, req.body ?? {});
    return cmd.adminRemove(deps, {
      ...admin(req, id),
      requestId: rid,
      ...(reason ? { reason } : {}),
      idempotencyKey: idemKey(req),
    });
  });

  app.post('/api/events/:id/admin/duplicate/:rid', async (req) => {
    const { id, rid } = parse(ridParams, req.params);
    const { decision } = parse(DuplicateDecisionBody, req.body);
    return cmd.reviewDuplicate(deps, { ...admin(req, id), requestId: rid, decision });
  });

  for (const [verb, run] of [
    ['start', cmd.startBreak],
    ['end', cmd.endBreak],
  ] as const) {
    app.post(`/api/events/:id/admin/breaks/:bid/${verb}`, async (req) => {
      const { id, bid } = parse(bidParams, req.params);
      return run(deps, { ...admin(req, id), breakId: bid });
    });
  }

  app.post('/api/events/:id/admin/handover/claim', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    limit(`handover:${req.ip}`, 10, MINUTE);
    requireSameOrigin(sec, req);
    const { code } = parse(HandoverClaimBody, req.body);
    const r = await cmd.claimHandover(deps, { eventId: id, code });
    reply.header('cache-control', 'no-store');
    return { ok: true, version: r.version, csrf: setAdminSession(sec, reply, id, r.adminSecret) };
  });

  app.post('/api/events/:id/admin/recover', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    limit(`handover:${req.ip}`, 10, MINUTE);
    requireSameOrigin(sec, req);
    const { recoverySecret } = parse(RecoverBody, req.body);
    const r = await cmd.recoverAdmin(deps, { eventId: id, recoverySecret });
    reply.header('cache-control', 'no-store');
    return { ok: true, version: r.version, csrf: setAdminSession(sec, reply, id, r.adminSecret) };
  });

  // ---- attendees ---------------------------------------------------------------------------
  app.post('/api/events/:id/join', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    limit(`join:${req.ip}`, 20, MINUTE);
    parse(JoinBody, req.body ?? {});
    reply.header('cache-control', 'no-store');
    return cmd.joinEvent(deps, { eventId: id });
  });

  app.post('/api/events/:id/requests', async (req) => {
    const { id } = parse(idParams, req.params);
    const who = participantFromRequest(req);
    limit(`submit:p:${who.participantId}`, 10, MINUTE);
    limit(`submit:ip:${req.ip}`, 30, MINUTE);
    const body = parse(SubmitRequestBody, req.body);
    const resolved = body.url
      ? await ingestion.resolveUrl(body.url)
      : ingestion.resolveManual(body.manual!);
    const r = await cmd.submitRequest(deps, {
      eventId: id,
      ...who,
      style: body.style,
      track: resolved.track,
      idempotencyKey: idemKey(req),
    });
    return { request: requestView(r.request, await agg(id)) };
  });

  // A whole (already sorted) playlist at once: songs are added in order until the quota is full.
  app.post('/api/events/:id/requests/batch', async (req) => {
    const { id } = parse(idParams, req.params);
    const who = participantFromRequest(req);
    limit(`batch:p:${who.participantId}`, 4, MINUTE);
    limit(`batch:ip:${req.ip}`, 12, MINUTE);
    const body = parse(BatchSubmitBody, req.body);
    const batchKey = idemKey(req) ?? randomUUID();
    const results: Array<{
      index: number;
      status: 'ADDED' | 'DUPLICATE' | 'QUOTA_FULL' | 'FAILED';
    }> = [];
    let full = false;
    for (const [index, song] of body.songs.entries()) {
      if (full) {
        results.push({ index, status: 'QUOTA_FULL' });
        continue;
      }
      try {
        const resolved = ingestion.resolveManual({
          title: song.title,
          ...(song.artist ? { artist: song.artist } : {}),
          ...(song.durationMs ? { durationMs: song.durationMs } : {}),
        });
        await cmd.submitRequest(deps, {
          eventId: id,
          ...who,
          style: body.style,
          track: { ...resolved.track, sourceUrl: safeSourceUrl(song.sourceUrl) },
          idempotencyKey: `${batchKey}:${index}`,
        });
        results.push({ index, status: 'ADDED' });
      } catch (e) {
        if (e instanceof DomainError && e.code === 'QUOTA_FULL') {
          full = true;
          results.push({ index, status: 'QUOTA_FULL' });
        } else if (e instanceof DomainError && e.code === 'DUPLICATE') {
          results.push({ index, status: 'DUPLICATE' });
        } else if (
          e instanceof DomainError &&
          ['UNAUTHORISED', 'EVENT_ENDED', 'EVENT_NOT_ACTIVE', 'NOT_FOUND', 'VALIDATION'].includes(
            e.code,
          )
        ) {
          throw e; // the whole request is wrong, not just one song
        } else {
          results.push({ index, status: 'FAILED' });
        }
      }
    }
    return { results, accepted: results.filter((r) => r.status === 'ADDED').length };
  });

  app.get('/api/events/:id/my-requests', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const who = participantFromRequest(req);
    await verifyParticipant(deps, id, who.participantId, who.token);
    reply.header('cache-control', 'no-store');
    return myRequests(await agg(id), who.participantId);
  });

  app.delete('/api/events/:id/requests/:rid', async (req) => {
    const { id, rid } = parse(ridParams, req.params);
    return cmd.withdrawRequest(deps, {
      eventId: id,
      ...participantFromRequest(req),
      requestId: rid,
      idempotencyKey: idemKey(req),
    });
  });

  // ---- player ------------------------------------------------------------------------------
  app.post('/api/events/:id/player/claim', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { takeover } = parse(PlayerClaimBody, req.body ?? {});
    const r = await cmd.claimLease(deps, {
      ...admin(req, id),
      ...(takeover !== undefined ? { takeover } : {}),
    });
    reply.header('cache-control', 'no-store');
    return { leaseToken: r.leaseToken, lease: r.lease };
  });

  // The YouTube videos that are the same recording as a Spotify song, best first (see ADR 0022).
  app.get('/api/events/:id/player/youtube/:rid', async (req, reply) => {
    const { id, rid } = parse(ridParams, req.params);
    limit(`yt-match:${req.ip}`, 60, MINUTE);
    await verifyAdmin(deps, id, admin(req, id).adminSecret);
    const r = (await agg(id)).requests.find((x) => x.id === rid);
    const spotifyId = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})$/.exec(
      r?.sourceUrl ?? '',
    )?.[1];
    reply.header('cache-control', 'no-store');
    if (!r || !spotifyId) return { videoIds: [] };
    const videoIds = await youtube.match(spotifyId, {
      title: r.title,
      artist: r.artist,
      durationMs: r.durationMs,
    });
    return { videoIds };
  });

  app.post('/api/events/:id/player/heartbeat', async (req) => {
    const { id } = parse(idParams, req.params);
    return cmd.heartbeat(deps, { eventId: id, ...parse(PlayerHeartbeatBody, req.body) });
  });

  app.post('/api/events/:id/player/started', async (req) => {
    const { id } = parse(idParams, req.params);
    const b = parse(PlayerStartedBody, req.body);
    return cmd.reportStarted(deps, {
      eventId: id,
      leaseToken: b.leaseToken,
      epoch: b.epoch,
      requestId: b.requestId,
      durationMs: b.durationMs ?? null,
    });
  });

  app.post('/api/events/:id/player/finished', async (req) => {
    const { id } = parse(idParams, req.params);
    return cmd.reportFinished(deps, { eventId: id, ...parse(PlayerFinishedBody, req.body) });
  });

  // Radio fallback (ADR 0023): the player says which station track is audible, and when it stops.
  app.post('/api/events/:id/player/radio/started', async (req) => {
    const { id } = parse(idParams, req.params);
    const b = parse(PlayerRadioStartedBody, req.body);
    return cmd.reportRadioStarted(deps, {
      eventId: id,
      leaseToken: b.leaseToken,
      epoch: b.epoch,
      stationId: b.stationId,
      trackKey: b.trackKey,
      title: b.title ?? null,
    });
  });

  app.post('/api/events/:id/player/radio/ended', async (req) => {
    const { id } = parse(idParams, req.params);
    return cmd.reportRadioEnded(deps, { eventId: id, ...parse(PlayerReleaseBody, req.body) });
  });

  app.post('/api/events/:id/player/release', async (req) => {
    const { id } = parse(idParams, req.params);
    return cmd.releaseLease(deps, { eventId: id, ...parse(PlayerReleaseBody, req.body) });
  });
}
