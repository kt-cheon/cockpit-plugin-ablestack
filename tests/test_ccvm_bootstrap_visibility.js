/* Regression checks for pending CCVM configuration, license gates and asynchronous status refreshes. */
async function testCcvmBootstrapVisibility(source) {
  let checks = 0;
  function assert(value, message) { checks++; if (!value) throw new Error(message); }
  function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
  const script = section('var ccvmBootstrapLicense =', '/** cloud vm start') + '\n' +
    section('function license_check(){', '/**') + '\n' +
    section('function CardCloudClusterStatus(){', 'function renderInfrastructureClusterStatus(');
  function deferred() {
    let resolve, reject;
    const promise = new Promise(function (yes, no) { resolve = yes; reject = no; });
    return {promise, resolve, reject};
  }
  async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
  function fixture(options = {}) {
    const elements = new Map(), calls = [], storage = new Map();
    if (options.state !== null) storage.set('ccvm_bootstrap_status', options.state || 'false');
    let clicks = 0;
    function $(selector, attributes) {
      if (selector[0] !== '<' && elements.has(selector)) return elements.get(selector);
      const element = {
        attributes: attributes || {}, content: '', children: [], visible: false, disabled: false, length: 1,
        empty() {
          this.children.forEach(function (child) { if (child.attributes.id) elements.delete('#' + child.attributes.id); });
          this.children = []; this.content = ''; return this;
        },
        text(value) { this.content = value; return this; },
        html(value) { this.empty(); this.content = value; return this; },
        hide() { this.visible = false; return this; }, show() { this.visible = true; return this; },
        toggle(value) { this.visible = value; return this; },
        prop(name, value) { this[name] = value; return this; },
        attr(name, value) { this.attributes[name] = value; return this; },
        on(event, callback) { this[event + 'Handler'] = callback; return this; },
        click() { if (!this.disabled) this.clickHandler(); },
        appendTo(parent) { parent.children.push(this); return this; }
      };
      if (selector[0] !== '<') elements.set(selector, element);
      if (attributes && attributes.id) elements.set('#' + attributes.id, element);
      return element;
    }
    const api = {spawn(argv, settings) {
      calls.push({argv, settings});
      if (argv[0] === 'curl') {
        if (options.license) return options.license.promise;
        if (options.error) return Promise.reject(new Error('license service unavailable'));
        return Promise.resolve(options.response === undefined ? '{"code":500}' : options.response);
      }
      if (argv.includes('status') && argv.includes('bootstrap')) {
        return options.bootstrap ? options.bootstrap.promise : Promise.resolve('{"code":200,"val":{"ccvm":"false"}}');
      }
      if (argv.includes('monitoring')) return Promise.resolve('{"code":200,"val":{"wall":"false"}}');
      return Promise.resolve('{"code":200,"val":{}}');
    }};
    const helper = new Function('$', 'ablestack', 'sessionStorage', 'os_type', 'pluginpath', 'pcs_exe_host',
      'ccvm_bootstrap_run', 'renderInfrastructureClusterStatus', 'createLoggerInfo', 'console',
      script + '\nreturn {renderCcvmBootstrapActions, license_check, CardCloudClusterStatus};')(
        $, api, {getItem(key) { return storage.has(key) ? storage.get(key) : null; }, setItem(key, value) { storage.set(key, String(value)); }},
        options.local ? 'ablestack-standalone' : 'ablestack-hci', '/plugin', 'cube1', function () { clicks++; },
        function () {}, function () {}, {log() {}});
    return {helper, $, calls, storage, get clicks() { return clicks; }};
  }

  const active = {oem: 'hv', expired: '2999-12-31'};
  for (const local of [false, true]) {
    const beforeId = local ? '#cloud-center-before-bootstrap-run' : '#ccvm-before-bootstrap-run';
    for (const scenario of [
      {response: '{"code":500}', label: '등록 필요', allowed: false},
      {response: JSON.stringify({oem: 'hv', expired: '2000-01-01'}), label: '만료', allowed: false},
      {response: JSON.stringify(active), allowed: true},
      {response: JSON.stringify(JSON.stringify(active)), allowed: true},
      {response: JSON.stringify({code: 200, val: active}), allowed: true},
      {response: JSON.stringify({code: 400, val: active}), label: '확인 실패', allowed: false},
      {response: JSON.stringify({oem: 'hv', expired: '2999-12-31', status: 'inactive'}), label: '비활성', allowed: false},
      {response: 'malformed response', label: '확인 실패', allowed: false},
      {response: JSON.stringify({oem: 'hv', expired: '2999-02-30'}), label: '확인 실패', allowed: false},
      {error: true, label: '확인 실패', allowed: false}
    ]) {
      const f = fixture(Object.assign({local}, scenario));
      f.helper.renderCcvmBootstrapActions();
      assert(f.$(beforeId).visible, 'pending configuration is visible even before the license reply');
      await f.helper.license_check();
      const button = f.$('#menu-item-bootstrap-run-ccvm');
      assert(f.$(beforeId).visible, 'a missing, expired or failed license check must not hide the configuration action');
      assert(button.disabled === !scenario.allowed, 'preserve the valid-license execution requirement');
      if (scenario.label) assert(button.content.includes(scenario.label), 'show why configuration cannot start');
      button.click();
      assert(f.clicks === (scenario.allowed ? 1 : 0), 'disabled configuration never invokes bootstrap');
      assert(f.storage.get('license_type') === (scenario.allowed ? 'hv' : ''), 'retain the active license type only');
      const updates = f.calls.filter(function (call) { return call.argv.includes('update'); });
      assert(updates.every(function (call) { return call.argv.includes('license') && !call.argv.includes('bootstrap'); }),
        'license refreshes must never change bootstrap completion flags');
      if (updates.length) {
        assert(updates[0].argv.slice(-3).join(' ') === 'status --value ' + String(scenario.allowed), 'save the license status');
        assert(updates[1].argv.slice(-3).join(' ') === 'type --value ' + (scenario.allowed ? 'hv' : ''), 'save the license type after its status');
      }
    }
  }

  for (const licenseFirst of [false, true]) {
    const license = deferred(), bootstrap = deferred();
    const f = fixture({state: null, license, bootstrap});
    const card = f.helper.CardCloudClusterStatus();
    const checked = f.helper.license_check();
    await flush();
    if (licenseFirst) {
      license.resolve(JSON.stringify(active));
      await checked;
      bootstrap.resolve('{"code":200,"val":{"ccvm":"false"}}');
    } else {
      bootstrap.resolve('{"code":200,"val":{"ccvm":"false"}}');
      await flush();
      assert(f.$('#ccvm-before-bootstrap-run').visible, 'show pending bootstrap while license verification is running');
      license.resolve(JSON.stringify(active));
    }
    await card;
    await checked;
    await flush();
    assert(f.$('#ccvm-before-bootstrap-run').visible && !f.$('#menu-item-bootstrap-run-ccvm').disabled,
      'late bootstrap and license replies converge on an enabled configuration action');
  }

  for (const response of ['{"code":500}', JSON.stringify(active)]) {
    const f = fixture({state: 'true', response});
    await f.helper.license_check();
    assert(!f.$('#ccvm-before-bootstrap-run').visible, 'completed configuration must not offer bootstrap again');
    assert(f.$('#ccvm-after-bootstrap-run').visible && f.$('#ccvm-after-bootstrap-run').content.includes('클라우드센터 연결'),
      'completed configuration retains its connection action');
  }
  return checks;
}

(function () {
  const isNode = typeof module === 'object' && module.exports;
  const source = isNode ? require('fs').readFileSync(require('path').join(__dirname, '../src/features/card-cloud-cluster-status.js'), 'utf8')
    : readFile('src/features/card-cloud-cluster-status.js');
  testCcvmBootstrapVisibility(source).then(function (count) {
    if (isNode) console.log(count + ' CCVM bootstrap visibility checks passed');
    else print(count + ' CCVM bootstrap visibility checks passed');
  }).catch(function (error) {
    if (isNode) { console.error(error); process.exitCode = 1; }
    else { print(error.message + '\n' + error.stack); quit(1); }
  });
}());
