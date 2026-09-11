import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * A device check in front of the stored master key.
 *
 * On Android the key survives an app restart, held in the hardware keystore, so
 * the app opens straight into the ledger. That is the right default for
 * everyday use and the wrong one for a phone that is found unlocked — at which
 * point the ledger is simply open. This puts a fingerprint, face or device
 * credential in front of it.
 *
 * It is not a second layer of encryption. The key is already protected by the
 * keystore; this is a presence check on the person holding the phone, and it is
 * described that way in the settings copy rather than implying more.
 */
const ENABLED_KEY = 'docket.biometricLock';

export type BiometricAvailability =
  | { available: true; kind: string }
  | { available: false; reason: string };

@Injectable({ providedIn: 'root' })
export class BiometricService {
  /**
   * Whether the device can perform the check.
   *
   * Never on the web: there is no stored key to protect there, since the
   * browser build holds the key in memory for one session and already asks for
   * a passphrase every time.
   */
  async availability(): Promise<BiometricAvailability> {
    if (!Capacitor.isNativePlatform()) {
      return { available: false, reason: 'Only on the installed app' };
    }

    try {
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      const result = await NativeBiometric.isAvailable({ useFallback: true });

      return result.isAvailable
        ? { available: true, kind: describe(result.biometryType) }
        : { available: false, reason: 'No fingerprint, face or screen lock is set up' };
    } catch {
      return { available: false, reason: 'This device cannot check' };
    }
  }

  async isEnabled(): Promise<boolean> {
    const { value } = await Preferences.get({ key: ENABLED_KEY });
    return value === 'true';
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await Preferences.set({ key: ENABLED_KEY, value: enabled ? 'true' : 'false' });
  }

  /**
   * Ask the device to confirm the user is present.
   *
   * Returns false rather than throwing on cancellation: a refusal is an
   * ordinary outcome — the user changed their mind, or a stranger picked up the
   * phone — and the caller simply leaves the vault locked.
   */
  async verify(reason = 'Unlock your ledger'): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    try {
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
      await NativeBiometric.verifyIdentity({
        reason,
        title: 'Easy Docket',
        subtitle: reason,
        useFallback: true,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function describe(type: number): string {
  // The plugin's enum, kept as numbers here so the import stays lazy.
  switch (type) {
    case 1:
      return 'Touch ID';
    case 2:
      return 'Face ID';
    case 3:
      return 'Fingerprint';
    case 4:
      return 'Face unlock';
    case 5:
      return 'Iris';
    case 7:
      return 'Device PIN';
    default:
      return 'Biometrics';
  }
}
