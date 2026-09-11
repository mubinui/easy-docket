import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Android build.
 *
 * `appId` is the Play Store package name and is effectively permanent: once an
 * app is published under it, it cannot be changed without shipping a different
 * listing. It matches the Android namespace in `android/app/build.gradle`.
 */
const config: CapacitorConfig = {
  appId: 'net.xiidea.docket',
  appName: 'Easy Docket',
  webDir: 'www',

  android: {
    // Match the browser's dark-mode handling rather than flashing white on a
    // cold start before Angular has applied the theme.
    backgroundColor: '#ffffff',
    // The ledger is local; there is nothing to gain from allowing mixed content.
    allowMixedContent: false,
    captureInput: true,
  },

  plugins: {
    // The keystore-backed store that holds the master key on device.
    SecureStoragePlugin: {},
    StatusBar: {
      overlaysWebView: false,
    },
  },

  server: {
    // HTTPS scheme so that WebCrypto is available: `crypto.subtle` is only
    // exposed on a secure origin, and the whole app depends on it.
    androidScheme: 'https',
  },
};

export default config;
