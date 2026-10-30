/* Run with Node or JavaScriptCore. All Cockpit, browser and download operations are simulated. */
async function testClusterEnrollment(source) {
  function assert(value, message) { if (!value) throw new Error(message); }
  const start = source.indexOf('async function prepareClusterAgent(');
  const end = source.indexOf('// Document.ready 시작', start);
  function fixture(options = {}) {
    const calls = [], inputs = [], elements = [], blobs = [], links = [];
    const registration = {format: 'ablestack-cube-enrollment-v1', host: 'cube2', privateMarker: 'private-key-must-stay-out-of-argv'};
    function $(selector, attributes) {
      const element = {
        selector, attributes, value: '', disabled: false,
        empty() { return this; }, text(value) { this.value = value; return this; },
        appendTo() { return this; }, val(value) { this.value = value; return this; },
        on(event, callback) { this[event] = callback; return this; }
      };
      elements.push(element);
      return element;
    }
    const api = {spawn(argv, settings) {
      calls.push({argv, settings});
      const promise = options.fail ? Promise.reject(new Error('Wrong host registration')) : Promise.resolve(
        argv.includes('export') ? '{"node.key":"download-private-key"}' : JSON.stringify({exports: options.exports || []}));
      promise.input = function (data, stream) { inputs.push({data, stream}); };
      return promise;
    }};
    const document = {body: {appendChild() {}}, createElement() {
      const element = {click() { links.push(this); }, remove() { this.removed = true; }};
      return element;
    }};
    function Blob(parts, settings) { blobs.push({parts, settings}); }
    const callbacks = [];
    const url = {createObjectURL() { return 'blob:private-download'; }, revokeObjectURL() {}};
    const helper = new Function('ablestack', '$', 'clusterAgentRegistration', 'document', 'URL', 'Blob', 'setTimeout',
      source.slice(start, end) + '\nreturn {prepareClusterAgent, registration: function(){return clusterAgentRegistration;}};')(
        api, $, registration, document, url, Blob, function (callback) { callbacks.push(callback); });
    return {helper, calls, inputs, elements, blobs, links};
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

  const fixture2 = fixture({exports: ['cube2', 'cube3']});
  await fixture2.helper.prepareClusterAgent('new', 'ablestack-hci', JSON.stringify(hosts), '192.0.2.31', ['cube1']);
  assert(fixture2.calls.length === 1 && fixture2.blobs.length === 0, 'never download another host private key automatically');
  const buttons = fixture2.elements.filter(function (element) { return element.selector === '<button>'; });
  assert(buttons.length === 2, 'show one registration download per cluster host');
  await buttons[0].click.call(buttons[0]);
  assert(fixture2.calls[1].argv.slice(-3).join(' ') === 'export --host cube2', 'download only the selected host registration');
  assert(fixture2.blobs[0].parts[0].includes('download-private-key'), 'use a private browser download instead of writing to static web paths');
  assert(fixture2.links[0].download === 'cube2.cube-agent.json' && fixture2.links[0].removed, 'name the file for the intended host and remove its DOM link');
  assert(buttons[0].disabled === false, 'restore download button after completion');

  const failed = fixture({fail: true});
  let rejected = false;
  try { await failed.helper.prepareClusterAgent('existing', 'ablestack-hci', '[]', '192.0.2.31', []); }
  catch (error) { rejected = /Wrong host/.test(error.message); }
  assert(rejected && failed.blobs.length === 0 && failed.helper.registration(), 'propagate failure and retain selected upload for retry');
  assert(source.indexOf('await prepareClusterTime();') < source.indexOf('await prepareClusterAgent(host_file_type'), 'apply time settings before certificate verification');
  return 16;
}

(function () {
  const isNode = typeof module === 'object' && module.exports;
  const source = isNode ? require('fs').readFileSync(require('path').join(__dirname, '../src/features/cluster-config-prepare.js'), 'utf8') : readFile('src/features/cluster-config-prepare.js');
  testClusterEnrollment(source).then(function (count) {
    if (isNode) console.log(count + ' cluster enrollment UI checks passed');
    else print(count + ' cluster enrollment UI checks passed');
  }).catch(function (error) {
    if (isNode) { console.error(error); process.exitCode = 1; }
    else { print(error.stack); quit(1); }
  });
}());
