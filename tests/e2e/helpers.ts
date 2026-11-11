import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';

/** Fails on serious/critical WCAG A/AA violations, listing them in the message. */
export async function expectAccessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`),
    `axe on ${label}`,
  ).toEqual([]);
}

export async function newPage(
  browser: Browser,
  contextOptions: Parameters<Browser['newContext']>[0],
) {
  const context = await browser.newContext(contextOptions);
  return { context, page: await context.newPage() };
}

/**
 * Adds one song by link: open the sheet, paste, tap the genre. The lookup is stubbed so the tests
 * never depend on Spotify being up.
 */
export async function addSong(page: Page, title: string, artist: string, genre: string) {
  await page.route('**/api/resolve-playlist', (route) =>
    route.fulfill({
      json: { tracks: [{ title, artist, durationMs: 200_000, sourceUrl: null }] },
    }),
  );
  await page.getByRole('button', { name: /Add a song/ }).click();
  await page.getByLabel('Search Spotify or paste a link').fill('https://open.spotify.com/track/x');
  await expect(page.getByRole('list', { name: 'Songs to add' })).toContainText(title);
  await page.getByRole('button', { name: `Add as ${genre}` }).click();
  await expect(page.getByText('1 added.')).toBeVisible();
  await page.unroute('**/api/resolve-playlist');
}

/** Opening the page is joining: wait for the codename and the add button. */
export async function joined(page: Page): Promise<string> {
  await expect(page.getByRole('button', { name: /Add a song/ })).toBeEnabled();
  return (await page.locator('.codename').innerText()).trim();
}

/** The page never needs vertical scrolling (the queue list is the one allowed exception). */
export async function expectNoScroll(page: Page, label: string) {
  const over = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollHeight - el.clientHeight;
  });
  expect(over, `${label} should fit the screen`).toBeLessThanOrEqual(1);
}

/** Drag across a row with the pointer: down, a few moves, up. */
export async function swipe(page: Page, row: import('@playwright/test').Locator, dx: number) {
  await row.scrollIntoViewIfNeeded();
  const b = (await row.boundingBox())!;
  const y = b.y + b.height / 2;
  const x = dx < 0 ? b.x + b.width - 70 : b.x + 70;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + 1);
  await page.mouse.up();
}
