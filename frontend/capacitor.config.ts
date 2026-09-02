/// <reference types="@capawesome/capacitor-nodejs" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hciptv.manager',
  appName: 'IPTV Manager',
  webDir: 'dist',
  server: {
    // "https://localhost" (padrão do Capacitor) bloqueia como "mixed
    // content" qualquer imagem/recurso http:// carregado pela página, mesmo
    // com cleartext liberado no Android — é uma política do Chromium
    // separada do usesCleartextTraffic. Servindo a própria página em
    // http://localhost evita esse conflito, já que praticamente todo painel
    // IPTV é http puro.
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    Nodejs: {
      nodeDir: 'nodejs',
      startMode: 'auto',
    },
  },
};

export default config;
