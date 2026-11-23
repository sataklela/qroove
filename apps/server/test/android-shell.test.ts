import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND } from '@qroove/config';

// The Android shell is Gradle/XML and cannot import this package; keep it in step with BRAND.
const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../../android/${p}`, import.meta.url)), 'utf8');
const host = new URL(BRAND.siteUrl).host;

describe('Android shell matches BRAND', () => {
  it('uses the package id', () => {
    const gradle = read('app/build.gradle.kts');
    expect(gradle).toContain(`applicationId = "${BRAND.android.packageId}"`);
    expect(gradle).toContain(`namespace = "${BRAND.android.packageId}"`);
  });
  it('points at the site', () => {
    expect(read('app/build.gradle.kts')).toContain(`val siteHost = "${host}"`);
    expect(read('app/src/main/res/values/strings.xml')).toContain(`https://${host}`);
    expect(read('app/src/main/res/values/strings.xml')).toContain(`>${BRAND.product}<`);
  });
});
