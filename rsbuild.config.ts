import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

const { publicVars } = loadEnv({ prefixes: ['PUBLIC_'] });

function getValidBasePath(val?: string): string {
  if (!val || val === '/') return '/';
  const trimmed = val.trim();
  // Pure numbers (such as Google Cloud project numbers like '651839954384') are not URL paths
  if (/^\d+$/.test(trimmed)) return '/';
  // Full URLs: extract pathname if non-root
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const pathname = new URL(trimmed).pathname;
      return pathname.length > 1 ? (pathname.endsWith('/') ? pathname : `${pathname}/`) : '/';
    } catch {
      return '/';
    }
  }
  // Hostnames / domains without subpath (e.g. 'agoraeuapasso.ai.studio')
  if (trimmed.includes('.') || trimmed.includes(':')) {
    return '/';
  }
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
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
