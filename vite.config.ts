import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    // Upload source maps to Sentry for readable stack traces in production.
    // Requires SENTRY_AUTH_TOKEN env var (build-time only, set in Vercel/CI).
    // Gracefully skipped if token is not present (local dev).
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: 'vela-5l',
            project: 'vela-react',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            sourcemaps: {
              filesToDeleteAfterUpload: ['./dist/**/*.map'],
            },
          }),
        ]
      : []),
    // Bundle analysis — generates stats.html on build
    // Usage: ANALYZE=true npm run build && open stats.html
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'stats.html',
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  build: {
    // Generate source maps for Sentry but don't ship them to users
    // (sentryVitePlugin deletes .map files after upload)
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          // Stable vendor chunks — cached across deploys
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          sentry: ['@sentry/react'],
        },
      },
    },
  },
});
