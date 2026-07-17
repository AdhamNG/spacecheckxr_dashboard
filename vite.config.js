import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** POST /api/mp-floorplan { "url": "https://..." } — fetch floorplan image server-side (CORS bypass). */
function mpFloorplanProxyPlugin() {
  return {
    name: 'mp-floorplan-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = req.url?.split('?')[0] ?? '';
        if (urlPath !== '/api/mp-floorplan' || req.method !== 'POST') {
          return next();
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyStr = Buffer.concat(chunks).toString();
        let parsed;
        try {
          parsed = JSON.parse(bodyStr);
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Invalid JSON');
          return;
        }
        const targetUrl = parsed?.url;
        if (typeof targetUrl !== 'string' || !targetUrl.startsWith('https://')) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Expected { "url": "https://..." }');
          return;
        }
        try {
          const r = await fetch(targetUrl, { headers: { 'User-Agent': 'vite-mp-floorplan/1.0' } });
          const buf = Buffer.from(await r.arrayBuffer());
          const ct = r.headers.get('content-type') || 'application/octet-stream';
          res.statusCode = r.status;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', ct);
          res.setHeader('Content-Length', String(buf.length));
          res.end(buf);
        } catch (e) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(e instanceof Error ? e.message : String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [mpFloorplanProxyPlugin()],
  /** Always load `.env` from this app folder, even if the shell cwd is elsewhere. */
  envDir: __dirname,
  server: {
    port: 3001,
    /** If 3001 is taken, exit instead of hopping ports — avoids "failed to fetch" when the app/proxy origin doesn't match. */
    strictPort: true,
    https: false,
    proxy: {
      '/api/multiset': {
        target: 'https://api.multiset.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/multiset/, ''),
        secure: true,
      },
      // Proxy to bypass S3 CORS for mesh downloads
      '/s3-proxy': {
        target: 'https://prod-multiset.s3-accelerate.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/s3-proxy/, ''),
        secure: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
});
