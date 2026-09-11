import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { beforeEach, describe, expect, it } from 'vitest';
import { BiometricService } from './biometric.service';

/**
 * The web build's behaviour, which is what these tests can observe: the check
 * is unavailable, and every path degrades to "not verified" rather than
 * throwing. The native path is exercised on a device.
 */
describe('BiometricService', () => {
  let biometrics: BiometricService;

  beforeEach(async () => {
    await Preferences.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [BiometricService] });
    biometrics = TestBed.inject(BiometricService);
  });

  it('is unavailable in a browser, and says why', async () => {
    // There is no stored key to protect on the web: the key lives in memory for
    // one session, and a passphrase is already required every time.
    const availability = await biometrics.availability();

    expect(availability.available).toBe(false);
    expect(availability).toHaveProperty('reason');
  });

  it('is off until asked for', async () => {
    expect(await biometrics.isEnabled()).toBe(false);
  });

  it('remembers the choice', async () => {
    await biometrics.setEnabled(true);
    expect(await biometrics.isEnabled()).toBe(true);

    await biometrics.setEnabled(false);
    expect(await biometrics.isEnabled()).toBe(false);
  });

  it('reports a failed check rather than throwing', async () => {
    // A refusal is an ordinary outcome — the user changed their mind, or a
    // stranger picked up the phone — and the caller just leaves the vault shut.
    await expect(biometrics.verify()).resolves.toBe(false);
  });
});
