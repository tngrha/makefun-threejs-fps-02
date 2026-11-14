// DUSTLINE local preview server: serves game/ over plain HTTP so the entry
// can be played and screenshotted from a browser. Node 22 standard library
// only; defaults to http://127.0.0.1:8080, or --port N (validated 1..65535).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = resolve(join(here, 'game'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

let port = 8080;
const portFlag = process.argv.indexOf('--port');
if (portFlag !== -1) {
  const value = Number(process.argv[portFlag + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`--port must be an integer from 1 to 65535, not ${process.argv[portFlag + 1]}`);
    process.exit(1);
  }
  port = value;
}

const server = createServer((req, res) => {
  const rawPath = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
  const relPath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\//, '');
  const filePath = resolve(join(gameDir, relPath));
  // Refuse anything that climbs out of game/.
  if (filePath !== gameDir && !filePath.startsWith(`${gameDir}/`)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('forbidden\n');
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('not found\n');
    return;
  }
  const body = readFileSync(filePath);
  res.writeHead(200, {
    'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DUSTLINE serving game/ at http://127.0.0.1:${port}/`);
});
