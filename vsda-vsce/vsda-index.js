const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHIM = 'ssh-vscode-shim';
const LOG = os.homedir() + '/.vscode-server/vsda-stub.log';

const COMMIT = require(path.join(__dirname, '..', '..', 'product.json')).commit;
if (!/^[0-9a-f]{40}$/.test(COMMIT)) throw new Error('commit not found');

class signer {
  sign(value) {
    try {
      const data = String(value);
      if (/[\r\n]/.test(data)) throw new Error('data contains newline');
      const out = execFileSync(SHIM, [], {
        input: 'vsda ' + COMMIT + ' ' + data + '\n',
        encoding: 'utf8',
        timeout: 20000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (!out) throw new Error('empty response');
      return out;
    } catch (e) {
      fs.appendFileSync(LOG, new Date().toISOString() + ' ' + String(e.stderr || e.message).trim() + '\n');
      throw e;
    }
  }
}

class validator {
  createNewMessage(m) { return m; }
  validate() { return 'ok'; }
}

module.exports = { signer, validator };
