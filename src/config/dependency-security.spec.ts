import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const platformRequire = createRequire(
  require.resolve('@nestjs/platform-express'),
);
const expressRequire = createRequire(platformRequire.resolve('express'));

describe('Dependency security regressions on the installed Express stack', () => {
  it('does not trust an arbitrary IPv4 client through an over-broad IPv4-mapped IPv6 subnet', () => {
    const proxyaddr = expressRequire('proxy-addr') as {
      compile(value: string): (address: string, index: number) => boolean;
    };
    const malformed = proxyaddr.compile('::ffff:10.0.0.0/8');
    expect(malformed('203.0.113.10', 0)).toBe(false);
    const correct = proxyaddr.compile('::ffff:10.0.0.0/104');
    expect(correct('10.1.2.3', 0)).toBe(true);
    expect(correct('203.0.113.10', 0)).toBe(false);
  });

  it('survives gzip trailing bytes and remains able to serve subsequent requests', async () => {
    // Isolate the historical uncaught-stream-error exploit in a child process:
    // a regression must fail this assertion, not terminate the Vitest worker.
    const script = String.raw`
      import { createRequire } from 'node:module';
      import { request } from 'node:http';
      import { gzipSync } from 'node:zlib';
      const require = createRequire(process.cwd() + '/package.json');
      const platformRequire = createRequire(require.resolve('@nestjs/platform-express'));
      const express = platformRequire('express');
      const app = express();
      app.use(express.json());
      app.post('/probe', (req, res) => res.json({ ok: true }));
      app.get('/health', (req, res) => res.json({ ok: true }));
      app.use((error, req, res, next) => res.status(error.status || 500).json({ error: true }));
      const server = app.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const send = (path, body) => new Promise((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length } : {},
          }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
          req.on('error', reject);
          req.end(body);
        });
        try {
          const body = Buffer.concat([gzipSync(Buffer.from('{"probe":"Tiếng Việt 😀"}')), Buffer.from('trailing-junk')]);
          const status = await send('/probe', body);
          const health = [await send('/health'), await send('/health')];
          console.log(JSON.stringify({ status, health }));
        } catch { process.exitCode = 1; }
        finally { server.closeAllConnections(); server.close(); }
      });
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        timeout: 4000,
      },
    );
    const result = JSON.parse(stdout);
    expect([200, 400]).toContain(result.status);
    expect(result.health).toEqual([200, 200]);
  });
});
