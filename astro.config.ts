import { defineConfig, fontProviders } from 'astro/config';

// Static output only. Every page must be readable with JS disabled.
export default defineConfig({
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  compressHTML: true,
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Fraunces',
      cssVariable: '--font-display',
      fallbacks: ['Georgia', 'serif'],
      options: {
        variants: [
          { src: ['./src/assets/fonts/fraunces-wght.woff2'], weight: '100 900', style: 'normal' },
          { src: ['./src/assets/fonts/fraunces-wght-italic.woff2'], weight: '100 900', style: 'italic' },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      fallbacks: ['ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      options: {
        variants: [{ src: ['./src/assets/fonts/jetbrains-mono-wght.woff2'], weight: '100 800', style: 'normal' }],
      },
    },
  ],
});
