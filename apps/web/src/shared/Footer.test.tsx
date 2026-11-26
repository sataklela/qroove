import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Footer } from './Footer';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Footer />
    </MemoryRouter>,
  );

describe('Footer', () => {
  afterEach(cleanup);

  it('introduces the company on the landing page', () => {
    at('/');
    expect(screen.getByText('Copyright © Sataklela OÜ 2026')).toBeInTheDocument();
    expect(
      screen.getByText('Qroove is a CSR initiative by the core development team of Sataklela OÜ.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute(
      'href',
      'https://sataklela.com',
    );
    expect(screen.getByText(/We're a friendly bunch :\)/)).toBeInTheDocument();
  });

  it('is one line everywhere else', () => {
    const { container } = at('/e/ABC123');
    expect(container.textContent).toBe('Copyright © Sataklela OÜ 2026');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
