import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH permite publicar en una subruta (GitHub Pages: /nombre-del-repo/).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Curador de Fotos',
        short_name: 'Curador',
        description: 'Ordena por fecha de captura, marca y exporta originales sin pérdida de calidad. Todo en local.',
        lang: 'es',
        theme_color: '#111317',
        background_color: '#111317',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Incluye el decodificador HEIC (WebAssembly empaquetado, ~2 MB) para uso sin conexión.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}'],
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  // Dependencias que solo usa el worker: declararlas evita recargas en desarrollo.
  optimizeDeps: { include: ['exifr', 'utif2', 'hash-wasm', 'idb', 'libheif-js/libheif-wasm/libheif-bundle.mjs'] },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2500 },
});
