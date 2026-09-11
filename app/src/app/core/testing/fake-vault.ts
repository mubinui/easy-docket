import { VaultService } from '../keys/vault.service';

/**
 * A `VaultService` stand-in holding a real `CryptoKey`.
 *
 * The real service reads device identity from Capacitor `Preferences`, which is
 * process-global; two simulated devices in one test process would otherwise
 * collide on the same stored identity. Only the handful of members the sync
 * engine actually uses are implemented.
 */
export function fakeVault(vaultId: string, deviceId: string, key: CryptoKey): VaultService {
  return {
    isUnlocked: () => true,
    status: () => 'unlocked',
    vaultId: () => vaultId,
    deviceId: () => deviceId,
    keyIsDurable: false,
    requireKey: () => key,
    requireVaultId: () => vaultId,
    requireDeviceId: () => deviceId,
  } as unknown as VaultService;
}
