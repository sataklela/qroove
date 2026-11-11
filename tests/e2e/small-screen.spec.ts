import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 360, height: 640 } });

async function overflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollHeight - el.clientHeight;
  });
}

test('landing, create and the organiser console fit a 360×640 phone', async ({ page }) => {
  await page.goto('/new');
  await expect(page.getByRole('spinbutton', { name: 'Total duration' })).toBeVisible();
  // The create form may scroll, but the timeline bar never grows wider than the screen.
  const bar = await page.getByRole('group', { name: /Evening timeline/ }).boundingBox();
  expect(bar!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(
    360,
  );
});

test('landing, the organiser console and the guest page fit a 360×640 phone without scrolling', async ({
  page,
  request,
  browser,
}) => {
  await page.goto('/');
  await expect(page.getByRole('textbox')).toHaveCount(6);
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // Thirty songs already queued: the page still does not scroll, only the queue does.
  const songs = Array.from({ length: 30 }, (_, i) => ({
    title: `Starter ${i + 1}`,
    artist: 'House Band',
    durationMs: 200_000,
    sourceUrl: null,
    style: i % 2 ? 'bachata' : 'salsa',
  }));
  const created = await (
    await request.post('/api/events', {
      data: { timezone: 'UTC', plannedDurationMin: 120, songs },
    })
  ).json();
  const hash = new URL(created.adminUrl).hash;
  await page.goto(`/a/${created.eventId}${hash}`);
  await expect(page.getByRole('button', { name: 'Pause At End of Current Song' })).toBeVisible();
  for (const tab of ['Playing', 'Invite', 'More']) {
    await page.getByRole('tab', { name: tab }).click();
    expect(await overflow(page), `${tab} tab`).toBeLessThanOrEqual(1);
  }
  expect(
    await page.locator('.page.more').evaluate((el) => el.scrollHeight - el.clientHeight),
    'settings fit their page',
  ).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: 'Invite' }).click();
  const qr = await page.getByRole('img', { name: /QR code/ }).boundingBox();
  expect(qr!.width).toBeGreaterThan(150); // still scannable at this size

  const guest = await (
    await browser.newContext({ viewport: { width: 360, height: 640 } })
  ).newPage();
  await guest.goto(`/e/${created.slug}`);
  await expect(guest.getByRole('button', { name: /Add a song/ })).toBeEnabled();
  expect(await overflow(guest), 'guest page').toBeLessThanOrEqual(1);
  const queue = guest.getByRole('region', { name: 'Queue' });
  // The queue is the one thing that scrolls, and the add button stays on screen.
  expect(await queue.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const add = await guest.getByRole('button', { name: /Add a song/ }).boundingBox();
  expect(add!.y + add!.height).toBeLessThanOrEqual(640);
  await guest.getByRole('button', { name: /Add a song/ }).click();
  await expect(guest.getByRole('button', { name: 'Add as Salsa' })).toBeVisible();
  expect(await overflow(guest), 'add sheet').toBeLessThanOrEqual(1);
  const bachata = await guest.getByRole('button', { name: 'Add as Bachata' }).boundingBox();
  expect(bachata!.y + bachata!.height).toBeLessThanOrEqual(640);
  await guest.context().close();
});
