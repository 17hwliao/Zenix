import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zenix.musicplayer',
  appName: 'Zenix',
  webDir: process.env.ZENIX_PLATFORM === 'ios' ? 'dist-ios' : 'dist-android',
  android: { backgroundColor: '#101117', allowMixedContent: false },
  ios: { backgroundColor: '#101117', contentInset: 'never', preferredContentMode: 'mobile', scrollEnabled: true },
};
export default config;
