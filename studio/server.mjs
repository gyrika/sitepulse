// Local recording studio for the SitePulse demo. Listens on this computer only.
import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 5199);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.homedir(), 'Videos');
const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');
const ORIGIN = `http://localhost:${PORT}`;

await mkdir(OUT_DIR, { recursive: true });
const sessions = new Map();

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function convert(input, output) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output,
    ]);
    let errors = '';
    ffmpeg.stderr.on('data', (chunk) => { errors += chunk; });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errors || `ffmpeg exited with ${code}`))));
  });
}

function openFile(file) {
  const [command, ...args] = {
    win32: ['cmd', '/c', 'start', '', file],
    darwin: ['open', file],
  }[process.platform] ?? ['xdg-open', file];
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.on('error', (error) => console.error(`Could not open the video: ${error.message}`));
  opener.unref();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    createReadStream(PAGE).pipe(res);
    return;
  }

  // Other websites open in the same browser must not be able to write files here.
  if (req.method !== 'POST' || req.headers.origin !== ORIGIN) return send(res, 403, { error: 'Not allowed' });

  try {
    if (url.pathname === '/start') {
      const id = `SitePulse-demo-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
      const webm = path.join(OUT_DIR, `${id}.webm`);
      sessions.set(id, { webm, mp4: path.join(OUT_DIR, `${id}.mp4`), stream: createWriteStream(webm) });
      return send(res, 200, { id });
    }

    const session = sessions.get(url.searchParams.get('id'));
    if (!session) return send(res, 404, { error: 'Unknown recording' });

    if (url.pathname === '/chunk') {
      for await (const part of req) {
        if (!session.stream.write(part)) await new Promise((resolve) => session.stream.once('drain', resolve));
      }
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/finish') {
      await new Promise((resolve) => session.stream.end(resolve));
      await convert(session.webm, session.mp4);
      const { size } = await stat(session.mp4);
      return send(res, 200, { file: session.mp4, backup: session.webm, megabytes: Math.round(size / 1048576) });
    }

    if (url.pathname === '/open') {
      openFile(session.mp4);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Studio ready at ${ORIGIN}  (keep this window open)`));
