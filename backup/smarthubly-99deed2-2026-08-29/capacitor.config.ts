import { CapacitorConfig } from '@capacitor/cli';

// App Android do módulo de garçom do SmartHubly — otimizado para
// maquininha Stone Smart POS (Android). O conteúdo roda a partir do
// servidor (smarthubly.pages.dev) para garantir dados sempre atualizados
// e notificações em tempo real via Supabase realtime.
const config: CapacitorConfig = {
  appId: 'company.smarthubly.garcom',
  appName: 'SmartHubly Garçom',
  webDir: 'dist',
  server: {
    url: 'https://smarthubly.pages.dev/garcom.html',
    cleartext: false,
    allowNavigation: ['smarthubly.pages.dev', '*.smarthubly.pages.dev'],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#ffffff',
      androidSplashResourceName: 'splash',
    },
    LocalNotifications: {},
  },
};

export default config;
