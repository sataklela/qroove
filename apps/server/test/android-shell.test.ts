import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND } from '@qroove/config';

// The Android shell (Capacitor, ADR 0029) is JSON/Gradle/XML and cannot import this package.
const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../mobile/${p}`, import.meta.url)), 'utf8');
const host = new URL(BRAND.siteUrl).host;

describe('Android shell matches BRAND', () => {
  it('uses the package id and points at the site', () => {
    const cfg = JSON.parse(read('capacitor.config.json')) as {
      appId: string;
      appName: string;
      server: { url: string };
    };
    expect(cfg.appId).toBe(BRAND.android.packageId);
    expect(cfg.appName).toBe(BRAND.product);
    expect(cfg.server.url).toBe(BRAND.siteUrl);
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain(`applicationId "${BRAND.android.packageId}"`);
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain(`<string name="site_host">${host}</string>`);
    expect(strings).toContain(
      `<string name="custom_url_scheme">${BRAND.android.packageId}</string>`,
    );
    expect(read('www/offline.html')).toContain(BRAND.siteUrl);
  });
  it('opens room links and sign-in returns in the app', () => {
    const m = read('android/app/src/main/AndroidManifest.xml');
    expect(m).toContain('android:autoVerify="true"');
    expect(m).toContain('android:pathPrefix="/e/"');
    expect(m).toContain('android:scheme="@string/custom_url_scheme" android:host="auth"');
  });
});
