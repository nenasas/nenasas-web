// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://nenasas.com.ar',
  server: {
    host: true,
    port: 45217,
    allowedHosts: ['.ngrok-free.dev'],
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
