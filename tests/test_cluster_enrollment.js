/* Run with Node or JavaScriptCore. All Cockpit, browser and download operations are simulated. */
async function testClusterEnrollment(source, downloadSource, modalSource, mainHtml) {
  let checks = 0;
  function assert(value, message) { checks++; if (!value) throw new Error(message); }
  const start = source.indexOf('async function prepareClusterAgent(');
  const end = source.indexOf('// Document.ready 시작', start);
  function fixture(options = {}) {
    const calls = [], inputs = [], elements = [], blobs = [], links = [], alerts = [], revoked = [];
    const containers = {};
    const registration = {format: 'ablestack-cube-enrollment-v1', host: 'cube2', privateMarker: 'private-key-must-stay-out-of-argv'};
    function $(selector, attributes) {
      if (selector[0] !== '<' && containers[selector]) return containers[selector];
      const element = {
        selector, attributes, value: '', disabled: false, children: [],
        empty() { this.value = ''; this.children = []; return this; }, text(value) { this.value = value; return this; },
        appendTo(parent) { parent.children.push(this); return this; }, val(value) { this.value = value; return this; },
        show() { this.visible = true; return this; },
        on(event, callback) { this[event] = callback; return this; }
      };
      elements.push(element);
      if (selector[0] !== '<') containers[selector] = element;
      return element;
    }
    const api = {spawn(argv, settings) {
      calls.push({argv, settings});
      let promise;
      if (options.fail) promise = Promise.reject(new Error('Wrong host registration'));
      else if (argv.includes('list-exports') && options.listError) promise = Promise.reject(new Error('List unavailable'));
      else if (argv.includes('export') && options.exportError) promise = Promise.reject(new Error('Export unavailable'));
      else promise = Promise.resolve(argv.includes('export') ? '{"node.key":"download-private-key"}' :
        JSON.stringify({exports: options.exports || ['cube2']}));
      promise.input = function (data, stream) { inputs.push({data, stream}); };
      return promise;
    }, file(path) { return {read() { return Promise.resolve('saved file'); }}; }};
    const document = {body: {appendChild() {}}, createElement() {
      const element = {click() { links.push(this); }, remove() { this.removed = true; }};
      return element;
    }};
    function Blob(parts, settings) { blobs.push({parts, settings}); }
    const callbacks = [];
    const url = {createObjectURL() { return 'blob:private-download'; }, revokeObjectURL(value) { revoked.push(value); }};
    const helper = new Function('ablestack', '$', 'clusterAgentRegistration', 'document', 'URL', 'Blob', 'setTimeout', 'alert',
      downloadSource + '\n' + source.slice(start, end) +
      '\nreturn {prepareClusterAgent, refreshClusterAgentRegistrationDownloads, registration: function(){return clusterAgentRegistration;}};')(
        api, $, registration, document, url, Blob, function (callback) { callbacks.push(callback); }, function (message) { alerts.push(message); });
    function openDownloadModal() {
      const handlerStart = modalSource.indexOf("$('#button-config-file-download').on('click'");
      const handlerEnd = modalSource.indexOf("$('#button-close-config-file-download')", handlerStart);
      new Function('$', 'ablestack', 'refreshClusterAgentRegistrationDownloads', 'window', 'pluginpath', 'downloadAsFile', 'alert',
        modalSource.slice(handlerStart, handlerEnd))($, api, helper.refreshClusterAgentRegistrationDownloads,
          {}, '/plugin', function () {}, function (message) { alerts.push(message); });
      $('#button-config-file-download').click();
    }
    return {helper, calls, inputs, elements, blobs, links, containers, callbacks, revoked, alerts, openDownloadModal};
  }
  const hosts = [{index: '1', hostname: 'cube1', ablecube: '192.0.2.11'}];
  const fixture1 = fixture();
  await fixture1.helper.prepareClusterAgent('existing', 'ablestack-vm', JSON.stringify(hosts), '192.0.2.31', ['cube1']);
  assert(fixture1.calls.length === 1, 'preparation must only invoke the local authenticated entry point');
  const call = fixture1.calls[0];
  assert(call.argv[1] === '/usr/libexec/ablestack/node-agent/cluster_enrollment.py', 'use the packaged enrollment implementation');
  assert(call.argv.slice(-2).join(' ') === '--source existing', 'joining must not create a separate CA');
  assert(!JSON.stringify(call).includes('private-key-must-stay-out-of-argv'), 'private material must not appear in argv or options');
  assert(fixture1.inputs.length === 1 && fixture1.inputs[0].stream !== true, 'send the full input and EOF once');
  const request = JSON.parse(fixture1.inputs[0].data);
  assert(request.registration.host === 'cube2' && request.registration.privateMarker, 'registration is delivered through stdin');
  assert(request.cluster.clusterConfig.type === 'ablestack-vm' && request.cluster.clusterConfig.ccvm.ip === '192.0.2.31', 'preserve selected topology and mobile CCVM address');
  assert(fixture1.helper.registration() === null, 'clear private upload contents after successful enrollment');
  const memberButtons = fixture1.containers['#cluster-agent-registration-downloads'].children;
  assert(memberButtons.length === 1 && memberButtons[0].children[0].value === 'cube2 통신 등록 파일 다운로드',
    'existing-file preparation shows the current host registration download');

  const fixture2 = fixture({exports: ['cube1', 'cube2', 'cube3']});
  await fixture2.helper.prepareClusterAgent('new', 'ablestack-hci', JSON.stringify(hosts), '192.0.2.31', ['cube1']);
  assert(fixture2.calls.length === 1 && fixture2.blobs.length === 0, 'never download another host private key automatically');
  const buttons = fixture2.elements.filter(function (element) { return element.selector === '<button>'; });
  assert(buttons.length === 3, 'show one registration download per cluster host');
  await buttons[1].click.call(buttons[1]);
  assert(fixture2.calls[1].argv.slice(-3).join(' ') === 'export --host cube2', 'download only the selected host registration');
  assert(fixture2.blobs[0].parts[0].includes('download-private-key'), 'use a private browser download instead of writing to static web paths');
  assert(fixture2.links[0].download === 'cube2.cube-agent.json' && fixture2.links[0].removed, 'name the file for the intended host and remove its DOM link');
  assert(buttons[1].disabled === false, 'restore download button after completion');
  fixture2.callbacks[0]();
  assert(fixture2.revoked[0] === 'blob:private-download', 'release the private download URL');

  for (const exports of [['cube1', 'cube2', 'cube3'], ['cube2'], ['cube3']]) {
    const saved = fixture({exports});
    saved.openDownloadModal();
    for (let flush = 0; flush < 8; flush++) await Promise.resolve();
    assert(saved.containers['#div-modal-config-file-download'].visible, 'open the saved configuration modal');
    assert(saved.calls.length === 1 && saved.calls[0].argv[2] === 'list-exports', 'list saved registrations without preparing the cluster');
    assert(saved.blobs.length === 0 && saved.inputs.length === 0, 'listing does not read private registration contents or upload data');
    const container = saved.containers['#modal-cluster-agent-registration-downloads'];
    assert(container.children.length === exports.length, 'show exactly the available host registrations after a page reload');
    await container.children[0].children[0].click();
    assert(saved.calls[1].argv.slice(-3).join(' ') === 'export --host ' + exports[0], 'saved configuration downloads use the selected host');
    assert(saved.links[0].download === exports[0] + '.cube-agent.json', 'saved downloads retain the per-host filename');
    await saved.helper.refreshClusterAgentRegistrationDownloads('#modal-cluster-agent-registration-downloads');
    assert(container.children.length === exports.length, 'reopening the modal replaces links instead of duplicating them');
  }

  const empty = fixture({exports: []});
  await empty.helper.refreshClusterAgentRegistrationDownloads('#modal-cluster-agent-registration-downloads');
  assert(empty.containers['#modal-cluster-agent-registration-downloads'].value.includes('없습니다'), 'show an empty state on hosts without registration');
  const unavailable = fixture({listError: true});
  await unavailable.helper.refreshClusterAgentRegistrationDownloads('#modal-cluster-agent-registration-downloads');
  assert(unavailable.containers['#modal-cluster-agent-registration-downloads'].value.includes('조회하지 못했습니다'), 'show a list failure without breaking other configuration downloads');
  const exportFailure = fixture({exportError: true});
  await exportFailure.helper.prepareClusterAgent('existing', 'ablestack-hci', JSON.stringify(hosts), '192.0.2.31', ['cube1']);
  const retryButton = exportFailure.containers['#cluster-agent-registration-downloads'].children[0].children[0];
  await retryButton.click();
  assert(!retryButton.disabled && exportFailure.alerts.length === 1 && !exportFailure.blobs.length, 'failed downloads restore the button for retry');

  const failed = fixture({fail: true});
  let rejected = false;
  try { await failed.helper.prepareClusterAgent('existing', 'ablestack-hci', '[]', '192.0.2.31', []); }
  catch (error) { rejected = /Wrong host/.test(error.message); }
  assert(rejected && failed.blobs.length === 0 && failed.helper.registration(), 'propagate failure and retain selected upload for retry');
  assert(source.indexOf('await prepareClusterTime();') < source.indexOf('await prepareClusterAgent(host_file_type'), 'apply time settings before certificate verification');
  assert(mainHtml.includes('id="modal-cluster-agent-registration-downloads"'), 'the saved configuration modal includes a registration download container');
  assert(mainHtml.indexOf('src/common/cluster-agent-registration.js') < mainHtml.indexOf('src/features/main.js'), 'load shared downloads before either feature uses them');
  return checks;
}

(function () {
  const isNode = typeof module === 'object' && module.exports;
  function read(path) {
    return isNode ? require('fs').readFileSync(require('path').join(__dirname, '..', path), 'utf8') : readFile(path);
  }
  testClusterEnrollment(read('src/features/cluster-config-prepare.js'), read('src/common/cluster-agent-registration.js'),
    read('src/features/card-cloud-cluster-status.js'), read('main.html')).then(function (count) {
    if (isNode) console.log(count + ' cluster enrollment UI checks passed');
    else print(count + ' cluster enrollment UI checks passed');
  }).catch(function (error) {
    if (isNode) { console.error(error); process.exitCode = 1; }
    else { print(error.stack); quit(1); }
  });
}());
