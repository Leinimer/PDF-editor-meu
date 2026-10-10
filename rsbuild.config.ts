import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

const { publicVars } = loadEnv({ prefixes: ['PUBLIC_'] });

function getValidBasePath(val?: string): string {
  if (!val || val === '/') return '/';
  if (val.startsWith('/')) return val;
  // If val is a domain without leading slash, use '/' for server.base
  if (val.includes('.') || val.includes(':')) return '/';
  return `/${val}`;
}

const basePath = getValidBasePath(process.env['PUBLIC_BASE_PATH']);

export default defineConfig(({ env }) => ({
  plugins: [pluginReact()],
  source: {
    entry: { index: './src/main.tsx' },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      ...publicVars,
    },
  },
  html: {
    template: './src/index.html',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    base: env === 'production' ? basePath : '/',
  },
  output: {
    assetPrefix: env === 'production' ? basePath : '/',
    // pdf.js and pdf-lib are large; raise the warning ceiling a little but
    // keep it as a guard against accidental bundle growth.
    target: 'web',
  },
  performance: {
    chunkSplit: {
      strategy: 'split-by-experience',
    },
  },
}));
