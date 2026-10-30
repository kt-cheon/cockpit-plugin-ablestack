/* Exercise SCVM/CCVM action gates with simulated read-only requests. */
async function testVmReadiness(read) {
  function assert(value, message) { if (!value) throw new Error(message); }
  let count = 0;
  for (const vm of ['scvm', 'ccvm']) {
    const source = read(vm === 'scvm' ? 'src/features/main.js' : 'src/features/card-cloud-cluster-status.js');
    const name = vm + '_bootstrap_run';
    const start = source.indexOf('function ' + name + '(');
    const section = source.slice(start, source.indexOf('/**', start));
    for (const scenario of ['no-agent', 'running', 'done']) {
      const elements = new Map(), calls = [];
      function $(id) {
        if (!elements.has(id)) elements.set(id, {shown: false, content: '',
          text(value) { this.content = value; this.kind = 'text'; return this; },
          html(value) { this.content = value; this.kind = 'html'; return this; },
          val(value) { this.content = value; return this; },
          show() { this.shown = true; return this; }});
        return elements.get(id);
      }
      const api = {spawn(argv) {
        calls.push(argv);
        const result = argv.includes('ping') ? (scenario === 'no-agent'
          ? {code: 500, val: 'TLS agent unavailable <example>'} : {code: 200})
          : {code: 200, val: ['status: ' + scenario]};
        return Promise.resolve(JSON.stringify(result));
      }};
      new Function('$', 'ablestack', 'pluginpath', 'createLoggerInfo', 'console', section + '\n' + name + '();')(
        $, api, '/usr/share/cockpit/ablestack', function () {}, {log() {}});
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const ready = elements.get('#div-modal-storage-vm-status-update');
      assert(Boolean(ready && ready.shown) === (scenario === 'done'), vm + ': only a ready VM may open the configuration action');
      count++;
      assert(calls.every(function (argv) { return argv.includes('ping') || argv.includes('status'); }), 'readiness must not run a deployment or repair');
      count++;
      if (scenario === 'no-agent') {
        const message = elements.get('#modal-status-alert-body');
        assert(message.kind === 'text' && message.content.includes('TLS agent unavailable'), 'show transport diagnostics as text');
        assert(calls.length === 1, 'do not query cloud-init after a failed agent connection');
        count += 2;
      }
    }
  }
  return count;
}

(function () {
  const isNode = typeof module === 'object' && module.exports;
  const read = isNode ? function (path) { return require('fs').readFileSync(require('path').join(__dirname, '..', path), 'utf8'); } : readFile;
  testVmReadiness(read).then(function (count) {
    if (isNode) console.log(count + ' VM readiness checks passed');
    else print(count + ' VM readiness checks passed');
  }).catch(function (error) {
    if (isNode) { console.error(error); process.exitCode = 1; }
    else { print(error.stack); quit(1); }
  });
}());
