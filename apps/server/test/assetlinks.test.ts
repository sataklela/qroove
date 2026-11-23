import { describe, expect, it } from 'vitest';
import { BRAND } from '@qroove/config';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';

describe('GET /.well-known/assetlinks.json', () => {
  it('is an empty list without signing certs', async () => {
    const app = await buildApp(parseEnv({ NODE_ENV: 'test' }));
    const res = await app.inject('/.well-known/assetlinks.json');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('lists the Android package and normalised fingerprints', async () => {
    const app = await buildApp(
      parseEnv({ NODE_ENV: 'test', ANDROID_CERT_SHA256: 'aa:bb , CC:DD' }),
    );
    const res = await app.inject('/.well-known/assetlinks.json');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: BRAND.android.packageId,
          sha256_cert_fingerprints: ['AA:BB', 'CC:DD'],
        },
      },
    ]);
    await app.close();
  });
});
