import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);

function buildPage() {
  const index = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'Styles.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'JavaScript.html'), 'utf8');
  const mockApi = fs.readFileSync(path.join(root, 'dev', 'preview-api.js'), 'utf8');
  return index
    .replace("<?!= include_('Styles'); ?>", styles)
    .replace("<?!= include_('JavaScript'); ?>", `<script>${mockApi}</script>\n${client}`);
}

const server = http.createServer((request, response) => {
  if (request.url === '/' || request.url === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(buildPage());
    return;
  }
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`porotter preview: http://127.0.0.1:${port}`);
});
