#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SHIM = 'ssh-vscode-shim';

function fail(msg) {
  process.stderr.write('vsce-sign (ssh shim): ' + msg + '\n');
  process.exit(1);
}

function findCommit() {
  for (let i = 0, d = __dirname; i < 8; i++, d = path.dirname(d)) {
    try {
      return JSON.parse(fs.readFileSync(path.join(d, 'product.json'), 'utf8')).commit;
    } catch {}
  }
  throw new Error('product.json not found');
}

const files = [];
const args = process.argv.slice(2).map(a => {
  const eq = a.startsWith('--') ? a.indexOf('=') : -1;
  const prefix = eq >= 0 ? a.slice(0, eq + 1) : '';
  const val = a.slice(prefix.length);
  if (path.isAbsolute(val) && fs.existsSync(val) && fs.statSync(val).isFile()) {
    files.push(val);
    return { prefix, file: files.length - 1 };
  }
  return { text: a };
});

const meta = files.map(f => {
  const ext = path.extname(f);
  return { size: fs.statSync(f).size, ext: /^\.[A-Za-z0-9]{1,16}$/.test(ext) ? ext : '' };
});

let commit;
try {
  commit = findCommit();
} catch (e) {
  fail(e.message);
}

const child = spawn(SHIM, [], { stdio: ['pipe', 'pipe', 'inherit'] });
child.on('error', e => fail(e.message));
child.stdin.on('error', () => {});
child.stdin.write('vsce ' + commit + ' ' + JSON.stringify({ args, files: meta }) + '\n');
for (const f of files) child.stdin.write(fs.readFileSync(f));
child.stdin.end();

let out = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', d => (out += d));
child.on('close', code => {
  if (code !== 0) fail('shim exited with ' + code);
  let r;
  try {
    r = JSON.parse(out);
  } catch {
    fail('bad response');
  }
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  process.exit(Number.isInteger(r.code) ? r.code : 1);
});
