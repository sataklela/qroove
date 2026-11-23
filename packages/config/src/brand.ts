export const BRAND = {
  product: 'Qroove',
  tagline: 'Fair, collaborative music queues for dance socials.',
  company: { name: 'Sataklela OÜ', shortName: 'Sataklela', url: 'https://sataklela.com' },
  initiative: 'Qroove is a CSR initiative by the core development team of Sataklela OÜ.',
  contactLine: "We're a friendly bunch :)",
  licence: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
  copyrightYear: 2026,
  // Single place to change on org transfer.
  repoUrl: 'https://github.com/raunak-h/qroove',
  privacyEmail: 'sataklela+qroove@gmail.com',
  siteUrl: 'https://qroove.sataklela.com',
  docsPath: '/docs',
  /** Android app (Capacitor shell around the site, sideloaded APK; ADR 0029). */
  android: { packageId: 'com.sataklela.qroove' },
  pilotCommunity: 'LSU Salsa Society (pilot community; not an endorsement)',
} as const;

/** The full line, for the landing page and the docs. */
export const copyrightLine = (): string =>
  `Copyright © ${BRAND.company.name} ${BRAND.copyrightYear}`;
/** The thin footer on every page after the landing page. */
export const shortCopyrightLine = (): string =>
  `Copyright © ${BRAND.company.shortName} ${BRAND.copyrightYear}`;
