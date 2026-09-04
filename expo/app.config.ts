import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Trap Chat',
  slug: 'trap-chat',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.trapchat.app',
    infoPlist: {
      NSCameraUsageDescription: 'Trap Chat needs camera access for video chat and pose detection games.',
      NSMicrophoneUsageDescription: 'Trap Chat needs microphone access for video chat.',
      NSLocationWhenInUseUsageDescription: 'Trap Chat uses approximate location for local matchmaking priority.',
    },
  },
  android: {
    package: 'com.trapchat.app',
    permissions: ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundColor: '#0a0a0a',
    },
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins: ['expo-camera', 'expo-location', 'expo-media-library'],
  extra: {
    eas: {
      projectId: '25db3307-abbf-40a1-8e42-3bde6465b35b',
    },
  },
};

export default config;

/**
 * Expo public variables are intentionally not placed in app config.
 * EXPO_PUBLIC_* values are inlined into the client bundle by Metro.
 */
