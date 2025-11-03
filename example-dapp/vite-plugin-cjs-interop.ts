/**
 * Vite plugin to handle .cjs files by transforming them to ESM
 */
import { Plugin } from 'vite';
import fs from 'fs';

export function cjsInterop(): Plugin {
  return {
    name: 'cjs-interop',
    enforce: 'pre',

    resolveId(id) {
      // Handle .cjs imports
      if (id.endsWith('.cjs')) {
        return id;
      }
      return null;
    },

    load(id) {
      // Only handle .cjs files from the contract directory
      if (id.includes('contract/src/managed') && id.endsWith('.cjs')) {
        console.log('[cjs-interop] Transforming:', id);

        // Resolve absolute path
        const absolutePath = id.startsWith('/') ? id : require.resolve(id);

        // Check if file exists
        if (!fs.existsSync(absolutePath)) {
          console.error('[cjs-interop] File not found:', absolutePath);
          return null;
        }

        // Read the .cjs file
        const content = fs.readFileSync(absolutePath, 'utf-8');

        // Transform require() calls to imports
        // This is a simple transformation - wrap the entire CJS module
        const transformed = `
          import { createRequire } from 'module';
          const require = createRequire(import.meta.url);
          ${content}
        `;

        return transformed;
      }
      return null;
    }
  };
}
