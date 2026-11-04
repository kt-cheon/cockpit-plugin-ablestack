/* Simulate Cockpit streaming and the configuration modal; no real configuration commands run. */
async function testCenterBootstrap(read) {
  let checks = 0;
  function assert(value, message) { checks++; if (!value) throw new Error(message); }
  const source = read('src/features/storage-vm-status-update.js');
  const elements = new Map(), processes = [], calls = [];
  let reloads = 0;
  let throwOnSpawn = false;
  function $(id) {
    if (!elements.has(id)) elements.set(id, {
      content: '', value: '', visible: false, disabled: false, 0: {scrollHeight: 100},
      text(value) { this.content = value; return this; },
      prop(name, value) { this[name] = value; return this; },
      val(value) { if (value === undefined) return this.value; this.value = value; return this; },
      show() { this.visible = true; return this; }, hide() { this.visible = false; return this; },
      toggle() { this.visible = !this.visible; return this; }, scrollTop() { return this; },
      on(event, callback) { this[event] = callback; return this; }
    });
    return elements.get(id);
  }
  const api = {spawn(argv, options) {
    calls.push({argv, options});
    if (throwOnSpawn) throw new Error('administrator bridge unavailable');
    const process = {
      stream(callback) { this.output = callback; return this; },
      then(resolve, reject) { this.resolve = resolve; this.reject = reject; return this; }
    };
    processes.push(process);
    return process;
  }};
  const run = new Function('$', 'ablestack', 'pluginpath', 'sessionStorage', 'location', 'createLoggerInfo', source + '\nreturn runCenterBootstrap;')(
    $, api, '/plugin', {getItem() { return 'hv'; }}, {reload() { reloads++; }}, function () {});

  for (const kind of ['scvm', 'ccvm']) {
    const completed = run(kind);
    const process = processes[processes.length - 1];
    assert($('#div-modal-center-bootstrap').visible, kind + ': show the progress modal');
    assert($('#button-close-center-bootstrap').disabled, kind + ': prevent closing during configuration');
    assert(calls[calls.length - 1].options.err === 'out', 'capture output without losing stderr progress');
    assert(calls[calls.length - 1].argv[2] === kind, 'run the selected center configuration');
    if (kind === 'ccvm') assert(calls[calls.length - 1].argv[3] === 'hv', 'preserve the selected license');
    const count = calls.length;
    await run(kind);
    assert(calls.length === count, 'ignore repeated configuration requests while running');
    process.output('raw password=private\n[ABLESTACK-PRO');
    process.output('GRESS] 점보 프레임 검사\n[ABLESTACK-PROGRESS] <target> (203.0.113.12): 3/3 응답\n');
    assert($('#center-bootstrap-log').content.includes('점보 프레임 검사'), 'display progress immediately before the process completes');
    assert($('#center-bootstrap-log').content.includes('<target>'), 'render target names as plain text');
    assert(!$('#center-bootstrap-log').content.includes('password='), 'discard raw command output from the public log');
    process.output('[ABLESTACK-PROGRESS] 구성 완료');
    const before = reloads;
    process.resolve();
    assert(await completed, 'successful configuration resolves successfully');
    assert($('#center-bootstrap-log').content.includes('구성 완료'), 'retain the final partial progress line');
    assert(!$('#button-close-center-bootstrap').disabled && !$('#center-bootstrap-spinner').visible, 'stop the spinner and allow closing after completion');
    assert(reloads === before, 'keep completed logs visible until the user closes');
    $('#button-close-center-bootstrap').click();
    assert(reloads === before + 1, 'refresh center status when closing a successful configuration');
  }

  const failed = run('scvm');
  const process = processes[processes.length - 1];
  process.output('[ABLESTACK-PROGRESS] cn-scvm2 (203.0.113.12): 2/3 응답\n');
  process.reject(new Error('exit status 1'));
  assert(!(await failed), 'failed preflight/configuration resolves as a failure');
  assert($('#center-bootstrap-log').content.includes('cn-scvm2'), 'retain the failing target');
  assert($('#center-bootstrap-status').content.includes('중단'), 'show configuration failure in the status');
  assert(!$('#button-close-center-bootstrap').disabled, 'allow dismissing failures');
  const before = reloads;
  $('#button-close-center-bootstrap').click();
  assert(reloads === before, 'failure does not reload and discard diagnostics');

  throwOnSpawn = true;
  assert(!(await run('ccvm')), 'synchronous start errors must not leave the modal running');
  assert(!$('#button-close-center-bootstrap').disabled && $('#center-bootstrap-log').content.includes('시작하지 못했습니다'),
    'show the start failure and restore controls');
  throwOnSpawn = false;

  $('#scvm-status-update-cmd').val('bootstrap');
  $('#button-storage-vm-status-update').click();
  assert($('#scvm-status-update-cmd').val() === '', 'consume the confirmation action once');
  assert(!$('#div-modal-spinner').visible, 'configuration uses the progress modal');
  processes[processes.length - 1].reject();
  const html = read('main.html');
  assert(html.includes('id="center-bootstrap-log"') && html.includes('role="log"'), 'the page provides an accessible progress log');
  return checks;
}

(function () {
  const isNode = typeof module === 'object' && module.exports;
  const read = isNode ? function (path) { return require('fs').readFileSync(require('path').join(__dirname, '..', path), 'utf8'); } : readFile;
  testCenterBootstrap(read).then(function (count) {
    if (isNode) console.log(count + ' center bootstrap UI checks passed');
    else print(count + ' center bootstrap UI checks passed');
  }).catch(function (error) {
    if (isNode) { console.error(error); process.exitCode = 1; }
    else { print(error.message + '\n' + error.stack); quit(1); }
  });
}());
