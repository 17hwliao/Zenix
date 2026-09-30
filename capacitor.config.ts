import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zenix.musicplayer',
  appName: 'Zenix',
  webDir: 'dist-android',
  android: { backgroundColor: '#101117', allowMixedContent: false },
};
export default config;
