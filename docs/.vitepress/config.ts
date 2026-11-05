import { defineConfig } from 'vitepress';
import { BRAND } from '../../packages/config/src/brand';

export default defineConfig({
  srcDir: 'src',
  base: `${BRAND.docsPath}/`,
  title: `${BRAND.product} Docs`,
  description: BRAND.tagline,
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${BRAND.docsPath}/favicon.png` }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: `${BRAND.product} Docs` }],
    ['meta', { property: 'og:description', content: BRAND.tagline }],
    ['meta', { property: 'og:image', content: `${BRAND.siteUrl}${BRAND.docsPath}/og-image.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  lastUpdated: false,
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Guide', link: '/guide/attendee' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API', link: '/api/reference' },
      { text: 'Runbook', link: '/runbook/deploy' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'License', link: '/license' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Attendees', link: '/guide/attendee' },
          { text: 'Organisers', link: '/guide/admin' },
          { text: 'Player', link: '/guide/player' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/architecture/overview' },
          { text: 'Scheduler', link: '/architecture/scheduler' },
          { text: 'Data model', link: '/architecture/data-model' },
          { text: 'Realtime', link: '/architecture/realtime' },
          { text: 'Security', link: '/architecture/security' },
        ],
      },
      { text: 'API', items: [{ text: 'Reference', link: '/api/reference' }] },
      {
        text: 'Runbook',
        items: [
          { text: 'Deploy', link: '/runbook/deploy' },
          { text: 'DNS (Cloudflare)', link: '/runbook/dns-cloudflare' },
          { text: 'Firebase', link: '/runbook/firebase' },
          { text: 'Backup', link: '/runbook/backup' },
          { text: 'Transfer ownership', link: '/runbook/transfer-ownership' },
        ],
      },
      {
        text: 'Decisions',
        items: [
          { text: '0001 Firestore', link: '/adr/0001-firestore' },
          { text: '0002 Single service', link: '/adr/0002-single-service' },
          { text: '0003 AGPL', link: '/adr/0003-agpl' },
          { text: '0004 No ageing bonus', link: '/adr/0004-no-ageing-bonus' },
          { text: '0005 Quota counts played', link: '/adr/0005-quota-counts-played' },
          { text: '0006 Aggregate event doc', link: '/adr/0006-aggregate-event-doc' },
          { text: '0007 Genre groups and ratios', link: '/adr/0007-genre-groups-and-ratios' },
          { text: '0008 QR-only join', link: '/adr/0008-qr-only-join' },
          { text: '0009 Single-genre spacing', link: '/adr/0009-single-genre-spacing' },
          { text: '0010 Break windows', link: '/adr/0010-break-windows' },
          { text: '0011 Rules per segment', link: '/adr/0011-per-segment-rules' },
          { text: '0012 Timeline and drums', link: '/adr/0012-visual-timeline-and-drums' },
          { text: '0013 Generated names', link: '/adr/0013-generated-event-names' },
          { text: '0014 Playlists per genre', link: '/adr/0014-playlists-per-genre' },
          { text: '0015 Permanent room code', link: '/adr/0015-permanent-room-code' },
          { text: '0016 Sortable playlists', link: '/adr/0016-sortable-playlist-import' },
          {
            text: '0017 Name, links, official players',
            link: '/adr/0017-required-name-link-only-official-players',
          },
          { text: '0018 Genre-only queue', link: '/adr/0018-genre-only-queue' },
          { text: '0019 Spotify Web Playback', link: '/adr/0019-spotify-web-playback' },
          { text: '0020 Spotify search and limits', link: '/adr/0020-spotify-browse-and-limits' },
          { text: '0021 UI overhaul', link: '/adr/0021-ui-overhaul' },
          { text: '0022 YouTube fallback playback', link: '/adr/0022-youtube-fallback-playback' },
          { text: '0023 Radio fallback', link: '/adr/0023-radio-fallback' },
        ],
      },
      {
        text: 'More',
        items: [
          { text: 'Privacy', link: '/privacy' },
          { text: 'Threat model', link: '/threat-model' },
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: BRAND.repoUrl }],
    search: { provider: 'local' },
    footer: {
      message: `Released under the <a href="${BRAND.docsPath}/license">${BRAND.licence.name}</a>.`,
      copyright: `Copyright © <a href="${BRAND.company.url}" rel="noopener">${BRAND.company.name}</a> ${BRAND.copyrightYear}`,
    },
  },
});
