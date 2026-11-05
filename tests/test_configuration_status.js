// Status queries use fixture files/commands; no host or VM configuration is changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(process.env.ABLESTACK_STATUS_TEST_SOURCE ||
  path.join(__dirname, '../src/features/main.js'), 'utf8');
const start = source.indexOf('function checkConfigStatus()');
const check = source.slice(start, source.indexOf('function checkLicenseStatus()', start));
// Include the previous reset implementation when exercising an older revision.
const reset = source.match(/function resetBootstrap\(\) \{[\s\S]*?\n\}\n/)?.[0] || '';

for (const scenario of ['configured', 'missing-public-key', 'hosts-query-error', 'no-host-entry', 'cluster-read-error', 'settings-read-error']) {
  test('configuration query preserves completed deployment flags: ' + scenario, {timeout: 2000}, async () => {
    const saved = {bootstrap: {scvm: 'true', ccvm: 'true', gfs_configure: 'true', local_configure: 'true'},
      monitoring: {wall: 'true'}, security_patch: {status: 'true'}};
    const original = JSON.parse(JSON.stringify(saved));
    const calls = [], session = new Map();
    const api = {async spawn(argv) {
      calls.push(argv);
      if (argv[0] === 'grep') {
        if (scenario === 'hosts-query-error') throw new Error('hosts read failed');
        return scenario === 'no-host-entry' ? '0\n' : '3\n';
      }
      if (argv[0] === 'cat') {
        if (argv[1] === '/root/.ssh/id_rsa.pub') {
          if (scenario === 'missing-public-key') throw new Error('public key missing');
          return 'fixture public key';
        }
        if (argv[1].endsWith('/cluster.json')) {
          if (scenario === 'cluster-read-error') throw new Error('cluster read failed');
          return JSON.stringify({clusterConfig: {iscsi_storage: 'false'}});
        }
        if (scenario === 'settings-read-error') throw new Error('settings read failed');
        return JSON.stringify(saved);
      }
      // Model the old write command so that reintroducing the reset reproduces data loss.
      if (argv.includes('ablestackJson.py') || argv.some((arg) => arg.endsWith('/ablestackJson.py'))) {
        saved[argv[argv.indexOf('--depth1') + 1]][argv[argv.indexOf('--depth2') + 1]] = argv[argv.indexOf('--value') + 1];
        return '{"code":200}';
      }
      throw new Error('Unexpected command: ' + argv.join(' '));
    }};
    const query = new Function('ablestack', 'sessionStorage', 'createLoggerInfo', 'saveHostInfo', 'pluginpath', 'console',
      check + reset + '\nreturn checkConfigStatus;')(
      api, {setItem: (key, value) => session.set(key, value)}, () => {}, () => {},
      '/usr/share/cockpit/ablestack', {log() {}});
    await query();
    await new Promise(setImmediate);
    assert.deepEqual(saved, original, 'reading configuration must never clear bootstrap or monitoring flags');
    assert.ok(calls.every((argv) => argv[0] === 'cat' || argv[0] === 'grep'), 'status queries only read files');
    assert.equal(session.get('ccfg_status'), ['missing-public-key', 'hosts-query-error', 'no-host-entry'].includes(scenario) ? 'false' : 'true');
  });
}
