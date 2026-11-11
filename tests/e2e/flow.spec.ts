import { expect, test } from '@playwright/test';
import { addSong, expectAccessible, expectNoScroll, joined, newPage, swipe } from './helpers';

test('one tap → guests join by opening → add, withdraw → live settings → hand over → end', async ({
  browser,
  page,
  baseURL,
}, info) => {
  const ctxOpts = { ...info.project.use, baseURL };

  // Landing: code boxes first, one screen --------------------------------------------------
  await page.goto('/');
  await expect(page.getByRole('textbox')).toHaveCount(6);
  await expect(page.getByRole('link', { name: 'Qroove home' })).toBeVisible();
  await expectNoScroll(page, 'landing');
  await expectAccessible(page, '/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expectAccessible(page, '/ (menu open)');
  await page.keyboard.press('Escape');

  // ONE tap: a default event, straight on the organiser page, already running ---------------
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/events') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start an event now' }).click();
  const made = (await (await created).json()) as { adminUrl: string; slug: string };
  expect(made.adminUrl).toContain('#k=');
  await expect(page).toHaveURL(/\/admin\//);
  await expect(page.getByRole('button', { name: 'Pause At End of Current Song' })).toBeVisible();
  await expect(page.getByText(/Save this link|recovery/i)).toHaveCount(0);
  // No event name: the room code is the name, and it is always in the top bar.
  const code = `${made.slug.slice(0, 3)}-${made.slug.slice(3)}`;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(code);
  await expect(page.locator('.topbar .event-token')).toContainText(code);
  const eventId = new URL(page.url()).pathname.split('/').pop()!;

  // The organiser console fits one screen on every page ------------------------------------
  await expectNoScroll(page, 'console (queue, empty)');
  await expectAccessible(page, '/admin (live)');
  await page.getByRole('tab', { name: 'Invite' }).click();
  await expect(page.getByRole('img', { name: /QR code to join/ })).toBeVisible();
  await expectNoScroll(page, 'console (invite)');
  await page.getByRole('tab', { name: 'More' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Event time' })).toHaveAttribute(
    'aria-valuetext',
    '2:00',
  );
  await expectNoScroll(page, 'console (more)');
  expect(
    await page.locator('.page.more').evaluate((el) => el.scrollHeight - el.clientHeight),
    'the settings fit without scrolling',
  ).toBeLessThanOrEqual(1);
  await expectAccessible(page, '/admin (settings)');
  await page.getByRole('tab', { name: 'Playing' }).click();

  // Right-click is blocked on the organiser page ---------------------------------------------
  const blocked = await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(blocked).toBe(true);

  // Typing the room code is enough: the guest is in, with a codename, without a tap ----------
  const typed = await newPage(browser, ctxOpts);
  await typed.page.goto('/');
  await typed.page.getByRole('textbox').first().click();
  await typed.page.keyboard.type(made.slug.toLowerCase());
  await expect(typed.page).toHaveURL(new RegExp(`/e/${made.slug}$`));
  expect(await joined(typed.page)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);

  // Three guests open the QR link and add a song each: paste, then one tap --------------------
  const people = [] as Awaited<ReturnType<typeof newPage>>[];
  const names: string[] = [];
  for (const [i, [title, artist, genre]] of [
    ['Song One', 'Band A', 'Salsa'],
    ['Song Two', 'Band B', 'Bachata'],
    ['Song Three', 'Band C', 'Salsa'],
  ].entries()) {
    const p = await newPage(browser, ctxOpts);
    people.push(p);
    await p.page.goto(`/e/${made.slug}`);
    names.push(await joined(p.page));
    if (i === 0) {
      await expectNoScroll(p.page, 'guest page');
      await expectAccessible(p.page, '/e/:slug (joined)');
      await p.page.getByRole('button', { name: /Add a song/ }).click();
      await expectNoScroll(p.page, 'guest page (add sheet)');
      await expectAccessible(p.page, '/e/:slug (add sheet)');
      await p.page.getByRole('button', { name: 'Close' }).click();
    }
    await addSong(p.page, title!, artist!, genre!);
  }
  expect(new Set(names).size).toBe(3);

  // Organiser sees all three, each with its guest's codename ----------------------------------
  const queue = page.getByRole('region', { name: 'Queue' });
  await expect(queue.getByText('Song Two')).toBeVisible();
  await expect(queue.getByText('Song Three')).toBeVisible();
  await expect(queue.getByText(names[1]!)).toBeVisible();

  // A guest withdraws their own song from the queue itself, with one swipe ---------------------
  const third = people[2]!.page;
  await swipe(third, third.locator('.qrow.mine .qrow-fg'), -260);
  await expect(third.getByText('Withdrew “Song Three”.')).toBeVisible();
  await expect(queue.getByText('Song Three')).toHaveCount(0);
  // The organiser removes one with a swipe too.
  await swipe(page, queue.locator('.qrow-fg', { hasText: 'Song Two' }), -260);
  await expect(queue.getByText('Song Two')).toHaveCount(0);
  await expect(people[1]!.page.getByText(/“Song Two”: Removed by the organiser/)).toBeVisible();

  // Settings change while the event runs: a new genre appears on the guests' phones ------------
  await page.getByRole('tab', { name: 'More' }).click();
  await page.getByRole('checkbox', { name: 'Cha-cha' }).click();
  await expect(page.getByRole('checkbox', { name: 'Cha-cha' })).toBeChecked();
  await third.getByRole('button', { name: /Add a song/ }).click();
  await expect(third.getByRole('button', { name: 'Add as Cha-cha' })).toBeVisible();
  await third.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: 'Playing' }).click();

  // Player in manual mode (no local file) ---------------------------------------------------
  await page.getByRole('button', { name: 'Mark started' }).click();
  await expect(page.getByRole('button', { name: 'Mark ended' })).toBeVisible();
  await expect(people[0]!.page.getByText('Song One').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark ended' }).click();
  await expect(page.getByRole('button', { name: 'Mark ended' })).toBeHidden();

  // Handover: the new admin works, the old one is rejected -----------------------------------
  await page.getByRole('tab', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Hand over', exact: true }).click();
  await page.getByRole('button', { name: 'Hand over admin' }).click();
  await page.getByRole('button', { name: 'Yes, create a handover link' }).click();
  const claim = (await page.locator('p.mono', { hasText: '/claim/' }).innerText()).trim();
  const second = await newPage(browser, ctxOpts);
  await second.page.goto(claim);
  await expect(second.page.getByRole('heading', { level: 1 })).toHaveText(code);
  await page.reload();
  await expect(page.getByText(/You do not have organiser access/)).toBeVisible();

  // End with two clicks and no typing --------------------------------------------------------
  const admin = second.page;
  await admin
    .getByRole('button', { name: 'Resume Playback' })
    .click()
    .catch(() => undefined);
  await admin.getByRole('tab', { name: 'More' }).click();
  await admin.getByRole('button', { name: 'End the event' }).click();
  await expect(admin.getByRole('textbox')).toHaveCount(0);
  await admin.getByRole('button', { name: 'End event' }).click();
  await admin.getByRole('button', { name: 'Yes, end the event now' }).click();
  await expect(admin.getByRole('heading', { name: 'Carry over to a new event' })).toBeVisible();
  await expectAccessible(admin, '/admin (ended)');
  await expect(typed.page.getByText('This event has ended.')).toBeVisible();

  // Remaining public pages ------------------------------------------------------------------
  await page.goto('/privacy');
  await expectAccessible(page, '/privacy');
  await page.goto(`/h/${made.slug}`);
  await expectAccessible(page, '/h/:slug');
  expect(eventId).toBeTruthy();

  for (const p of [typed, ...people, second]) await p.context.close();
});

test('the detailed planner is one link away and still plans breaks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Plan in detail' }).click();
  await expectAccessible(page, '/new');
  await expect(page.getByRole('spinbutton', { name: 'Total duration' })).toHaveAttribute(
    'aria-valuetext',
    '2:00',
  );
  // Pressing and holding the bar adds a break in the middle of the part.
  const part1 = page.getByRole('button', { name: /^Part 1 of 1/ });
  await part1.click();
  const box = (await part1.boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /^Part/ })).toHaveCount(2);
  await expectAccessible(page, '/new (with a break)');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/admin\//);
  await expect(page.getByRole('button', { name: /Start break/ })).toBeVisible();
});
