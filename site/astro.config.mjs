import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://bidwise.pages.dev',
  output: 'static',
  // /classes/ only redirects to /explore/.
  integrations: [svelte(), sitemap({ filter: (page) => !page.endsWith('/classes/') })],
});
