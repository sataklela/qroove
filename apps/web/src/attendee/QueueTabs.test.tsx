import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QueueTabs } from './QueueTabs';

const setup = () =>
  render(<QueueTabs mineCount={2} queue={<p>the queue</p>} mine={<p>my list</p>} />);

describe('QueueTabs', () => {
  afterEach(cleanup);
  it('shows the queue by default and My songs on the other tab', () => {
    setup();
    expect(screen.getByText('the queue')).toBeTruthy();
    expect(screen.queryByText('my list')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'My songs (2)' }));
    expect(screen.getByText('my list')).toBeTruthy();
  });

  it('swipes left to My songs and back, but ignores short or vertical drags', () => {
    setup();
    const root = screen.getByRole('tablist').parentElement!;
    const drag = (dx: number, dy = 0) => {
      fireEvent.touchStart(root, { touches: [{ clientX: 200, clientY: 200 }] });
      fireEvent.touchEnd(root, { changedTouches: [{ clientX: 200 + dx, clientY: 200 + dy }] });
    };
    drag(-20);
    drag(-100, 150);
    expect(screen.getByText('the queue')).toBeTruthy();
    drag(-100);
    expect(screen.getByText('my list')).toBeTruthy();
    drag(100);
    expect(screen.getByText('the queue')).toBeTruthy();
  });
});
