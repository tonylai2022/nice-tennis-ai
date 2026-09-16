import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const legacyTennisRedirect: Plugin = {
  name: 'legacy-tennis-redirect',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const requestUrl = request.url ?? '/';
      const [pathname, query] = requestUrl.split('?', 2);
      if (pathname === '/tennis' || pathname === '/tennis/') {
        response.statusCode = 302;
        response.setHeader('Location', `/${query ? `?${query}` : ''}`);
        response.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [legacyTennisRedirect, react()],
  server: {
    host: true,
    port: 5174,
    hmr: {
      clientPort: 5174,
    },
    allowedHosts: true,
  },
  build: {
    target: ['es2015', 'chrome87', 'firefox78', 'safari14', 'edge88'],
  },
  optimizeDeps: {
    esbuildOptions: {
      target: ['es2015', 'chrome87', 'firefox78', 'safari14', 'edge88'],
    },
  },
});
