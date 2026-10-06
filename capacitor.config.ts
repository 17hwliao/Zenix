import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zenix.musicplayer',
  appName: 'Zenix',
  webDir: process.env.ZENIX_PLATFORM === 'ios' ? 'dist-ios' : 'dist-android',
  android: { backgroundColor: '#101117', allowMixedContent: false },
  // MainActivity owns Android system-bar and IME spacing. Capacitor 8 would
  // otherwise also pad the decor view, leaving a second gap above the keyboard.
  plugins: process.env.ZENIX_PLATFORM === 'ios' ? {} : { SystemBars: { insetsHandling: 'disable' } },
  ios: { backgroundColor: '#101117', contentInset: 'never', preferredContentMode: 'mobile', scrollEnabled: true },
};
export default config;
