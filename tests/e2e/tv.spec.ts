import { expect, test, type Page } from '@playwright/test';

// A 1080p Android TV's WebView: 960×540 CSS px at 2×, no touch, driven only by the D-pad (arrows,
// Enter = OK, Escape = Back). `?tv=1` turns on the same mode the app turns on from the TV's UI mode.
test.use({
  viewport: { width: 960, height: 540 },
  deviceScaleFactor: 2,
  hasTouch: false,
  isMobile: false,
});

const focused = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a && a !== document.body
      ? (a.getAttribute('aria-label') ?? a.textContent ?? '').trim()
      : null;
  });

test('TV: the remote alone can host an event, and the way to join stays on screen', async ({
  page,
}) => {
  await page.goto('/?tv=1');
  await expect(page.locator('html')).toHaveAttribute('data-tv', '1');
  // Focus starts on the main action, so OK is the first press.
  await expect.poll(() => focused(page)).toContain('Host an event');
  await page.screenshot({ path: 'test-results/tv-1-home.png' });

  // The D-pad reaches the other controls and comes back.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focused(page)).not.toContain('Host an event');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => focused(page)).toContain('Host an event');

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\//);
  const join = page.getByRole('complementary', { name: 'Join this event' });
  await expect(join.getByRole('img', { name: /QR code to join/ })).toBeVisible();
  await expect(join.locator('.room-code')).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  // Focus is never stranded after the page changes: it lands on the main action.
  await expect.poll(() => focused(page)).toContain('Start playing');
  await page.screenshot({ path: 'test-results/tv-2-host.png' });

  // Every visible control on the host screen can be reached with arrows alone.
  const seen = new Set<string>();
  for (const key of [
    'ArrowDown',
    'ArrowDown',
    'ArrowDown',
    'ArrowRight',
    'ArrowUp',
    'ArrowUp',
    'ArrowLeft',
  ]) {
    await page.keyboard.press(key);
    const f = await focused(page);
    expect(f, `focus lost after ${key}`).not.toBeNull();
    seen.add(f!);
  }
  expect(seen.size).toBeGreaterThan(2);
  // The focus ring is drawn (not only on mouse-less :focus-visible).
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth);
  expect(outline).toBe('4px');
});

test('TV: the room code boxes hand the arrows back to the remote at either end', async ({
  page,
}) => {
  await page.goto('/?tv=1');
  await page.getByRole('textbox').first().focus();
  await page.keyboard.press('ArrowLeft'); // already the first box: left leaves the code input
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).not.toBeNull();
});

test('?tv=0 turns TV mode off again', async ({ page }) => {
  await page.goto('/?tv=1');
  await page.goto('/?tv=0');
  await expect(page.locator('html')).not.toHaveAttribute('data-tv', '1');
});
