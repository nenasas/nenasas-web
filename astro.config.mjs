// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://nenasas.com.ar',
  adapter: vercel(),
  // PayPal IPN is a server POST with no Origin header. Astro would reject it.
  security: {
    checkOrigin: false,
  },
  server: {
    host: true,
    port: 45217,
    allowedHosts: ['.ngrok-free.dev'],
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
