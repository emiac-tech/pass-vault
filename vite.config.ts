import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Bind the IPv4 loopback so http://127.0.0.1:5173 works (matches the URL the
  // app, the browser extension, and the share deep links all use). Without this,
  // Vite binds only to IPv6 [::1] and 127.0.0.1 connections fail.
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
