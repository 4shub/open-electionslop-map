import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.geojson': 'application/geo+json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

export async function createStaticServer(directory) {
    const root = await realpath(directory);
    const isInsideRoot = file => file === root || file.startsWith(root + path.sep);
    return createServer(async (request, response) => {
        function reply(status, message) {
            response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
            response.end(request.method === 'HEAD' ? undefined : message);
        }
        if (!['GET', 'HEAD'].includes(request.method)) {
            response.setHeader('allow', 'GET, HEAD');
            reply(405, 'Method not allowed');
            return;
        }
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
            reply(400, 'Invalid request path');
            return;
        }
        const file = path.resolve(root, `.${pathname}`);
        if (!isInsideRoot(file) || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
            reply(403, 'Forbidden');
            return;
        }
        try {
            let target = await realpath(file);
            if (!isInsideRoot(target)) { reply(403, 'Forbidden'); return; }
            let info = await stat(target);
            if (info.isDirectory()) {
                if (!pathname.endsWith('/')) {
                    const url = new URL(request.url, 'http://localhost');
                    response.writeHead(301, { location: `${url.pathname}/${url.search}` });
                    response.end();
                    return;
                }
                target = await realpath(path.join(target, 'index.html'));
                if (!isInsideRoot(target)) { reply(403, 'Forbidden'); return; }
                info = await stat(target);
            }
            if (!info.isFile()) { reply(404, 'Not found'); return; }
            response.writeHead(200, {
                'content-type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
                'content-length': info.size,
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
            });
            if (request.method === 'HEAD') { response.end(); return; }
            const stream = createReadStream(target);
            stream.on('error', () => response.destroy());
            response.on('close', () => stream.destroy());
            stream.pipe(response);
        } catch (error) {
            if (['ENOENT', 'ENOTDIR'].includes(error.code)) reply(404, 'Not found');
            else if (error.code === 'EACCES') reply(403, 'Forbidden');
            else { console.error(error); reply(500, 'Could not read file'); }
        }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const { values, positionals } = parseArgs({ options: { port: { type: 'string', default: '8000' } }, allowPositionals: true });
        if (positionals.length > 1) throw new Error('Usage: node scripts/serve.mjs [public|dist] [--port 8000]');
        const port = Number(values.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer between 0 and 65535.');
        const directory = fileURLToPath(new URL(`../${positionals[0] || 'public'}/`, import.meta.url));
        const server = await createStaticServer(directory);
        server.once('error', error => { console.error(error.message); process.exitCode = 1; });
        server.listen(port, '127.0.0.1', () => {
            console.log(`Serving ${directory}\nLocal: http://127.0.0.1:${server.address().port}/`);
        });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
