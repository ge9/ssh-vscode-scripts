// powershell>
// $env:ELECTRON_RUN_AS_NODE = 1
// & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" ".\vsda-server.js" | Out-Host
const { execFile } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const PORT = 47001;
//const LOG_FILE = path.join(os.homedir(), '.vsda-server.log');
const APP_DIR = process.argv[2]; // 任意: resources/app を直接指定する場合
const MAX_HEADER = 65536;
const MAX_BODY = 512 * 1024 * 1024;
const VSCE_SIGN = process.platform === 'win32' ? 'vsce-sign.exe' : 'vsce-sign';

function log(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n';
  //try { fs.appendFileSync(LOG_FILE, line); } catch {}
  process.stdout.write(line);
}

function appDirs(commit) {
  const exeDir = path.dirname(process.execPath);
  return [
    APP_DIR,
    path.join(exeDir, commit.slice(0, 10), 'resources', 'app'),
    path.join(exeDir, 'resources', 'app'),
    path.join(exeDir, '..', 'Resources', 'app'),
  ].filter(Boolean).filter(app => {
    try {
      return JSON.parse(fs.readFileSync(path.join(app, 'product.json'), 'utf8')).commit === commit;
    } catch {
      return false;
    }
  });
}

function findInApp(commit, ...rel) {
  for (const app of appDirs(commit)) {
    for (const nm of ['node_modules', 'node_modules.asar.unpacked']) {
      const p = path.join(app, nm, ...rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function sign(commit, data) {
  const dir = findInApp(commit, 'vsda');
  if (!dir) throw new Error('vsda not found for ' + commit + ' (execPath=' + process.execPath + ')');
  const { signer } = require(dir);
  return new signer().sign(data);
}

const TEXT = /^[A-Za-z0-9._:=-]{1,64}$/;
const PREFIX = /^(--[A-Za-z0-9-]+=)?$/;
const EXT = /^(\.[A-Za-z0-9]{1,16})?$/;

function parseHeader(line) {
  let m = /^vsda ([0-9a-f]{40}) (.*)$/.exec(line);
  if (m) return { kind: 'sign', commit: m[1], data: m[2], total: 0 };

  m = /^vsce ([0-9a-f]{40}) (\{.*\})$/.exec(line);
  if (!m) throw new Error('bad request');
  const spec = JSON.parse(m[2]);
  if (!Array.isArray(spec.args) || !Array.isArray(spec.files) || spec.args.length > 32 || spec.files.length > 8) {
    throw new Error('bad vsce request');
  }
  if (!spec.args[0] || spec.args[0].text !== 'verify') throw new Error('only verify is allowed');
  for (const a of spec.args) {
    const isText = typeof a.text === 'string' && TEXT.test(a.text);
    const isFile = Number.isInteger(a.file) && a.file >= 0 && a.file < spec.files.length && PREFIX.test(a.prefix || '');
    if (!isText && !isFile) throw new Error('bad vsce arg');
  }
  let total = 0;
  for (const f of spec.files) {
    if (!Number.isInteger(f.size) || f.size < 0 || !EXT.test(f.ext || '')) throw new Error('bad vsce file');
    total += f.size;
  }
  if (total > MAX_BODY) throw new Error('too large');
  return { kind: 'vsce', commit: m[1], args: spec.args, files: spec.files, total };
}

function runVsceSign(req, body, sock) {
  const exe = findInApp(req.commit, '@vscode', 'vsce-sign', 'bin', VSCE_SIGN);
  if (!exe) throw new Error('vsce-sign not found for ' + req.commit);

  sock.setTimeout(0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vsce-'));
  let off = 0;
  const paths = req.files.map((f, i) => {
    const p = path.join(tmp, 'f' + i + (f.ext || ''));
    fs.writeFileSync(p, body.subarray(off, off + f.size));
    off += f.size;
    return p;
  });
  const args = req.args.map(a => (typeof a.text === 'string' ? a.text : (a.prefix || '') + paths[a.file]));

  execFile(exe, args, {
    cwd: path.dirname(exe),
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  }, (err, stdout, stderr) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    const spawnFailed = err && typeof err.code !== 'number';
    const code = err ? (spawnFailed ? -1 : err.code) : 0;
    log('vsce-sign exit=' + code + ' ' + req.commit.slice(0, 10));
    sock.end(JSON.stringify({ code, stdout, stderr: spawnFailed ? err.message : stderr }) + '\n');
  });
}

function handle(req, body, sock) {
  try {
    if (req.kind === 'sign') {
      sock.end(sign(req.commit, req.data));
      log('sign ok ' + req.commit.slice(0, 10));
    } else {
      runVsceSign(req, body, sock);
    }
  } catch (e) {
    log('error: ' + e.message);
    sock.destroy();
  }
}

net.createServer(sock => {
  const chunks = [];
  let len = 0;
  let done = false;
  let req = null;
  sock.setTimeout(30000, () => sock.destroy());
  sock.on('error', () => {});
  sock.on('data', chunk => {
    if (done) return;
    chunks.push(chunk);
    len += chunk.length;

    if (!req) {
      const buf = Buffer.concat(chunks);
      const i = buf.indexOf(10);
      chunks.length = 0;
      chunks.push(buf);
      if (i < 0) {
        if (len > MAX_HEADER) sock.destroy();
        return;
      }
      try {
        req = parseHeader(buf.subarray(0, i).toString('utf8'));
      } catch (e) {
        done = true;
        log('error: ' + e.message);
        return sock.destroy();
      }
      req.headerLen = i + 1;
    }

    if (len < req.headerLen + req.total) return;
    done = true;
    const body = Buffer.concat(chunks).subarray(req.headerLen, req.headerLen + req.total);
    handle(req, body, sock);
  });
}).listen(PORT, '127.0.0.1', () => log('listening on 127.0.0.1:' + PORT));
