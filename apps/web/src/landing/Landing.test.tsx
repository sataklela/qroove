import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../routes';
import { useLockedPage } from '../shared/useLockedPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const home = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <AppRoutes />
    </MemoryRouter>,
  );

describe('Landing', () => {
  it('puts the six code boxes first and auto-advances as you type', async () => {
    home();
    expect(boxes()).toHaveLength(6);
    const user = userEvent.setup();
    await user.click(boxes()[0]!);
    await user.keyboard('ab1');
    expect(
      boxes()
        .map((b) => b.value)
        .join(''),
    ).toBe('AB1');
    expect(boxes()[3]).toHaveFocus();
    await user.keyboard('{Backspace}{Backspace}');
    expect(
      boxes()
        .map((b) => b.value)
        .join(''),
    ).toBe('A');
    expect(boxes()[1]).toHaveFocus();
  });

  it('shows the code as two triplets and opens the event when the sixth character is in', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', async () => {
      await gate; // hold the lookup so the boxes can be inspected first
      return new Response(
        JSON.stringify({ eventId: 'e', slug: 'ABC123', name: 'Mango Octopus Rye' }),
      );
    });
    home();
    expect(screen.getByText('-')).toBeInTheDocument(); // the hyphen between the triplets
    const user = userEvent.setup();
    await user.click(boxes()[0]!);
    await user.paste(' ab-c123 '); // stray characters and a typed hyphen are ignored
    expect(
      boxes()
        .map((b) => b.value)
        .join(''),
    ).toBe('ABC123');
    release();
    // A found event opens straight away: the code alone is enough to join.
    await waitFor(() => expect(screen.queryByText('Enter code')).toBeNull());
  });

  it('starts a default event in one tap and goes straight to the organiser page', async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      sent.push({ url, body: init.body ? JSON.parse(init.body as string) : null });
      if (url === '/api/events') {
        return new Response(
          JSON.stringify({
            eventId: 'ev9',
            slug: 'ABC123',
            adminUrl: 'http://x/a/ev9#k=secret-secret-secret',
          }),
          { status: 201 },
        );
      }
      if (url.endsWith('/admin/session')) {
        return new Response(JSON.stringify({ ok: true, csrf: 'c' }));
      }
      // The organiser page itself is not under test here.
      return new Response(JSON.stringify({ error: { code: 'X', message: '', action: '' } }), {
        status: 503,
      });
    });
    home();
    const user = userEvent.setup();
    // No form in between: the defaults are stated, and the planner is one small link away.
    expect(
      screen.getByText(/2 hours · Salsa and Bachata in turn · 20 songs each/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan in detail' })).toHaveAttribute('href', '/new');
    await user.click(screen.getByRole('button', { name: 'Start an event now' }));
    await waitFor(() => expect(sent[0]).toBeDefined());
    expect(sent[0]!.url).toBe('/api/events');
    expect(sent[0]!.body).toMatchObject({ starter: true });
    expect(Object.keys(sent[0]!.body as object).sort()).toEqual(['starter', 'timezone']);
    // The entry route exchanges the secret for a session.
    await waitFor(() =>
      expect(sent.some((c) => c.url.endsWith('/api/events/ev9/admin/session'))).toBe(true),
    );
  });

  it('says plainly when no event has that code', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'm', action: 'a' } }), {
          status: 404,
        }),
    );
    home();
    const user = userEvent.setup();
    await user.click(boxes()[0]!);
    await user.paste('ZZZZZZ');
    await waitFor(() => expect(screen.getByText('No event has that code.')).toBeInTheDocument());
  });

  it('has the logo as a home link on the left; a sun/moon toggle and a three-line menu on the right', async () => {
    document.documentElement.dataset.theme = 'dark';
    home();
    const user = userEvent.setup();
    expect(screen.getByRole('link', { name: 'Qroove home' })).toHaveAttribute('href', '/');
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveTextContent(''); // an icon, not the word
    // The theme toggle sits beside the menu, outside it.
    await user.click(menu);
    const panel = screen.getByRole('group', { name: 'Menu' });
    expect(within(panel).queryByRole('button', { name: /mode/i })).toBeNull();
    expect(
      within(panel)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Docs', 'Privacy', 'Source']);
    expect(within(panel).queryByRole('button', { name: /Session rules/ })).toBeNull(); // no event
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});

describe('useLockedPage', () => {
  it('blocks the context menu while mounted and restores it afterwards', () => {
    function Page() {
      useLockedPage();
      return <p>locked</p>;
    }
    const { unmount } = render(<Page />);
    const blocked = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    document.body.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(document.body.classList.contains('locked')).toBe(true);
    unmount();
    const free = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    document.body.dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);
  });
});
