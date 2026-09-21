// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  server: {
    host: true,
    port: 45217,
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
