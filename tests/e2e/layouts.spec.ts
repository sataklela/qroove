import { expect, test, type Page } from '@playwright/test';

// The organiser console's three arrangements (apps/web/src/admin/layout.ts).
test.use({ hasTouch: false, isMobile: false, deviceScaleFactor: 1 });

async function host(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Host an event' }).click();
  await expect(page).toHaveURL(/\/admin\//);
  await expect(page.getByRole('img', { name: /QR code to join/ })).toBeAttached();
}

const layout = (page: Page) => page.locator('div.console').getAttribute('data-layout');

test('landscape tablet / desktop: the QR sits beside the queue, controls below it', async ({
  page,
}) => {
  for (const [w, h] of [
    [1180, 820],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await host(page);
    expect(await layout(page)).toBe('split');
    await expect(page.getByRole('tablist', { name: 'Organiser sections' })).toBeHidden();
    await expect(page.getByRole('img', { name: /QR code to join/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    const qr = await page.getByRole('img', { name: /QR code to join/ }).boundingBox();
    const queue = await page.locator('.page.live').boundingBox();
    expect(qr!.x).toBeGreaterThan(queue!.x + queue!.width - 1);
    await page.screenshot({ path: `test-results/layout-split-${w}.png` });
  }
});

test('wall (TV, projector, very wide screen): one screen, every control, QR in the corner', async ({
  page,
}) => {
  for (const [w, h] of [
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await host(page);
    expect(await layout(page)).toBe('wall');
    await page.screenshot({ path: `test-results/layout-wall-${w}.png` });
    await expect(page.getByRole('tablist', { name: 'Organiser sections' })).toBeHidden();
    // Every control panel is open at once.
    await expect(page.getByRole('heading', { name: 'Hand over', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'End the event' })).toBeVisible();
    const qr = (await page.getByRole('img', { name: /QR code to join/ }).boundingBox())!;
    expect(qr.width).toBeLessThan(220);
    expect(qr.x + qr.width).toBeGreaterThan(w - 260);
    expect(qr.y + qr.height).toBeGreaterThan(h - 300);
    // The badge never covers a control.
    const more = (await page.locator(".page.more").boundingBox())!;
    expect(qr.y).toBeGreaterThanOrEqual(more.y + more.height - 1);
    // Nothing scrolls the page sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
  }
});

test('big-screen view can be forced on a laptop and turned back off', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await host(page);
  expect(await layout(page)).toBe('split');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Big-screen view: off/ }).click();
  expect(await layout(page)).toBe('wall');
  await page.screenshot({ path: 'test-results/layout-wall-forced-1366.png' });
  await page.reload();
  expect(await layout(page)).toBe('wall');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Big-screen view: on/ }).click();
  expect(await layout(page)).toBe('split');
});

test('portrait phone keeps the swipe pages', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await host(page);
  expect(await layout(page)).toBe('portrait');
  await expect(page.getByRole('tab', { name: 'Invite' })).toBeVisible();
  await page.screenshot({ path: 'test-results/layout-portrait-412.png' });
});
