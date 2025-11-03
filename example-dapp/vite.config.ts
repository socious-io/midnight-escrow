import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
  define: {
    global: 'window', // Define global as window
  },
  server: {
    port: 3001, // Use 3001 (3000 might be taken by web-app-v2)
    headers: {
      // Allow WebAssembly execution in development
      'Content-Security-Policy':
        "default-src * 'self' 'unsafe-inline' 'unsafe-eval' data: blob: wasm-unsafe-eval; script-src * 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src * 'self' blob:;",
    },
  },
  plugins: [
    react(),
    tsconfigPaths(),
    wasm(),
    nodePolyfills({
      // Enable all polyfills
      include: ['net', 'fs', 'path', 'crypto', 'stream', 'util', 'buffer', 'process', 'events'],
      // Whether to polyfill node's global `process` and `Buffer` objects
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Whether to polyfill `node:` protocol imports
      protocolImports: true,
    })
  ],
  optimizeDeps: {
    exclude: [
      // Exclude Midnight packages with WASM and top-level await issues
      '@midnight-ntwrk/onchain-runtime',
      '@midnight-ntwrk/wallet',
      'fetch-blob',
      'formdata-polyfill',
    ],
    include: [
      // Force pre-bundling of packages with CommonJS/ESM issues
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
      '@midnight-ntwrk/ledger',
    ],
    esbuildOptions: {
      target: 'es2022',
      supported: {
        'top-level-await': true,
      },
    },
  },
  ssr: {
    noExternal: ['midnight-escrow'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress "Module level directives cause errors when bundled" warnings
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return;
        }
        // Suppress unresolved import warnings for polyfills
        if (warning.code === 'UNRESOLVED_IMPORT' && warning.message.includes('vite-plugin-node-polyfills')) {
          return;
        }
        warn(warning);
      },
    },
  },
});
