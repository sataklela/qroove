/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import { BRAND } from '../../packages/config/src/brand';

export default defineConfig({
  plugins: [
    react(),
    // `ANALYZE=1 pnpm build` writes stats.json (gitignored) (gzip sizes per module) for bundle budgeting.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'stats.json',
            template: 'raw-data',
            gzipSize: true,
          }) as unknown as PluginOption,
        ]
      : []),
    {
      name: 'qroove-site-url',
      transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', BRAND.siteUrl),
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-32.png', 'icons/apple-touch-icon.png', 'icons/og-image.png'],
      manifest: {
        name: 'Qroove',
        short_name: 'Qroove',
        description: 'Fair, collaborative music queues for dance socials.',
        theme_color: '#1c1b1f',
        background_color: '#1c1b1f',
        display: 'standalone',
        id: '/',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: { navigateFallbackDenylist: [/^\/api\//, /^\/docs(\/|$)/] },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
});
