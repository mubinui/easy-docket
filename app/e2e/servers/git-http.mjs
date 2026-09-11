/**
 * A real Git smart-HTTP remote, for the end-to-end suite.
 *
 * `git http-backend` is the CGI program every Git host runs behind its web
 * server, so wrapping it here means the adapter is tested against the actual
 * protocol rather than an imitation of it. The only addition is CORS: a browser
 * cannot reach a normal Git host directly, which is why the app offers a proxy
 * setting, and allowing the origin here lets the test exercise the adapter
 * itself rather than somebody's proxy.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const PORT = Number(process.env.GIT_PORT ?? 9418);
const ROOT = process.env.GIT_ROOT ?? '/tmp/docket-git';
const ORIGIN = process.env.GIT_ALLOW_ORIGIN ?? '*';

/** Headers isomorphic-git needs to see and send for smart HTTP over CORS. */
const ALLOW_HEADERS = [
  'accept',
  'accept-encoding',
  'authorization',
  'cache-control',
  'content-type',
  'git-protocol',
  'pragma',
  'range',
  'user-agent',
  'x-requested-with',
].join(', ');

const EXPOSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-type',
  'etag',
  'location',
  'pragma',
  'www-authenticate',
].join(', ');

export function createBareRepo(name = 'vault.git') {
  rmSync(`${ROOT}/${name}`, { recursive: true, force: true });
  mkdirSync(`${ROOT}/${name}`, { recursive: true });

  execFileSync('git', ['init', '--bare', '--initial-branch=main', `${ROOT}/${name}`]);
  // Pushing over HTTP is refused unless the repository opts in.
  execFileSync('git', ['-C', `${ROOT}/${name}`, 'config', 'http.receivepack', 'true']);
  return `${ROOT}/${name}`;
}

export function startGitServer() {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', ORIGIN);
    response.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    response.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url, `http://localhost:${PORT}`);

    const backend = spawn(
      execFileSync('git', ['--exec-path']).toString().trim() + '/git-http-backend',
      [],
      {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: ROOT,
          GIT_HTTP_EXPORT_ALL: '1',
          REQUEST_METHOD: request.method,
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.replace(/^\?/, ''),
          CONTENT_TYPE: request.headers['content-type'] ?? '',
          CONTENT_LENGTH: request.headers['content-length'] ?? '',
          HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
          REMOTE_USER: 'tester',
          REMOTE_ADDR: '127.0.0.1',
        },
      },
    );

    request.pipe(backend.stdin);

    // CGI replies with headers, a blank line, then the body.
    const chunks = [];
    let headersSent = false;

    backend.stdout.on('data', (chunk) => {
      if (headersSent) {
        response.write(chunk);
        return;
      }

      chunks.push(chunk);
      const buffered = Buffer.concat(chunks);
      const split = buffered.indexOf('\r\n\r\n');
      if (split === -1) return;

      for (const line of buffered.subarray(0, split).toString().split('\r\n')) {
        const [name, ...rest] = line.split(':');
        if (rest.length) response.setHeader(name.trim(), rest.join(':').trim());
      }
      headersSent = true;
      response.write(buffered.subarray(split + 4));
    });

    backend.stdout.on('end', () => response.end());
    backend.stderr.on('data', (data) => process.stderr.write(`git-http-backend: ${data}`));
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => resolve(server));
  });
}

// Started directly, it just runs until killed.
if (process.argv[1]?.endsWith('git-http.mjs')) {
  mkdirSync(ROOT, { recursive: true });
  createBareRepo();
  await startGitServer();
  console.log(`git http-backend listening on ${PORT}, root ${ROOT}`);
}
