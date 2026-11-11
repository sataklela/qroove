import { expect, test } from '@playwright/test';
import { expectAccessible, joined, swipe } from './helpers';

const tracks = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((t) => ({
  title: t,
  artist: 'Band',
  durationMs: 200_000,
  sourceUrl: null,
}));

test('a guest sorts a playlist by swiping, then adds only the songs they have room for', async ({
  page,
  request,
}) => {
  await page.route('**/api/resolve-playlist', (route) => route.fulfill({ json: { tracks } }));
  const created = await (
    await request.post('/api/events', {
      data: {
        timezone: 'UTC',
        plannedDurationMin: 120,
        enabledStyles: ['salsa', 'bachata'],
        submissionLimit: 3,
      },
    })
  ).json();
  const admin = await page.context().browser()!.newContext();
  const a = await admin.newPage();
  await a.goto(`/a/${created.eventId}${new URL(created.adminUrl).hash}`);
  await expect(a.getByRole('button', { name: 'Pause At End of Current Song' })).toBeVisible();

  await page.goto(`/e/${created.slug}`);
  await joined(page);
  await page.getByRole('button', { name: /Add a song/ }).click();
  await page
    .getByLabel('Search Spotify or paste a link')
    .fill('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  const list = page.getByRole('list', { name: 'Songs to add' });
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(5);
  // Three songs allowed: the fourth and fifth are greyed out.
  await expect(rows.nth(3)).toHaveClass(/over/);
  await expect(rows.nth(2)).not.toHaveClass(/over/);
  await expectAccessible(page, '/e/:slug (playlist list)');

  // Swipe right on the last song: a green arrow shows, and it slides to the top.
  await swipe(page, rows.nth(4).locator('.song-fg'), 220);
  await expect(rows.first()).toHaveAccessibleName(/^Echo/);
  // Swipe left on the second song (Alpha): it is removed.
  await swipe(page, rows.nth(1).locator('.song-fg'), -240);
  await expect(rows).toHaveCount(4);
  await expect(list.getByText('Alpha')).toHaveCount(0);
  // Now Echo, Bravo, Charlie are active and Delta is greyed out.
  await expect(rows.nth(3)).toHaveClass(/over/);

  await page.getByRole('button', { name: 'Add as Salsa' }).click();
  await expect(page.getByText('3 added.')).toBeVisible();
  // They are in the one queue, marked as this guest's.
  const mine = page.getByRole('region', { name: 'Queue' }).locator('.qrow.mine');
  await expect(mine).toHaveCount(3);
  await expect(mine.filter({ hasText: 'Echo' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Queue' }).getByText('Delta')).toHaveCount(0);
  await admin.close();
});

test('a guest finds a song by searching, with no Spotify login', async ({ page, request }) => {
  await page.route('**/api/spotify/search*', (route) =>
    route.fulfill({
      json: {
        tracks: [
          {
            title: 'Vivir Mi Vida',
            artist: 'Marc Anthony',
            durationMs: 252_000,
            sourceUrl: 'https://open.spotify.com/track/3QHMxEOAGD51PDlbFPHLyJ',
          },
        ],
      },
    }),
  );
  const created = await (
    await request.post('/api/events', {
      data: { timezone: 'UTC', plannedDurationMin: 120, enabledStyles: ['salsa', 'bachata'] },
    })
  ).json();
  const admin = await page.context().browser()!.newContext();
  const a = await admin.newPage();
  await a.goto(`/a/${created.eventId}${new URL(created.adminUrl).hash}`);
  await expect(a.getByRole('button', { name: 'Pause At End of Current Song' })).toBeVisible();

  await page.goto(`/e/${created.slug}`);
  await joined(page);
  await page.getByRole('button', { name: /Add a song/ }).click();
  await page.getByLabel('Search Spotify or paste a link').fill('vivir');
  await page.getByRole('button', { name: 'Vivir Mi Vida Marc Anthony' }).click();
  await expect(page.getByRole('list', { name: 'Songs to add' })).toContainText('Vivir Mi Vida');
  await expectAccessible(page, '/e/:slug (search)');
  await page.getByRole('button', { name: 'Add as Salsa' }).click();
  await expect(page.getByText('1 added.')).toBeVisible();
  await admin.close();
});
