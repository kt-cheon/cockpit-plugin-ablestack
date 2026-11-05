import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { bundleModule, cockpitFixture } from './helpers/bundle.mjs';

let services, fixture, handler;
before(async () => {
  fixture = cockpitFixture((request) => handler(request));
  globalThis.__cockpitTestStub = fixture.cockpit;
  globalThis.window = { location: { search: '' }, btoa: (value) => Buffer.from(value, 'binary').toString('base64'), setTimeout: (fn) => setTimeout(fn, 0) };
  services = await bundleModule(`
    export * from './src/services/api/client.ts';
    export * from './src/services/api/license.ts';
    export { fetchCloudClusterStatus } from './src/services/api/cloud-cluster-status.ts';
    export { fetchDeployStatus } from './src/services/api/deploy-status.ts';
    export { fetchNicInventory } from './src/services/api/inventory.ts';
  `);
});

test('request payload travels on stdin to the existing tool bridge', async () => {
  handler = () => ({ code: 200 });
  const secret = 'private input';
  await services.requestCubeApi('/api/v1/cube/license', { method: 'POST', body: { license_content: secret } });
  const call = fixture.calls.at(-1);
  assert.equal(call.argv[1], '/usr/share/cockpit/ablestack/python/react_bridge/bridge.py');
  assert.ok(!call.argv.join(' ').includes(secret));
  assert.equal(call.request.body.license_content, secret);
});

test('active license with null OEM remains active', async () => {
  handler = () => ({ code: '200', val: { status: 'active', oem: null, expired: '9999-12-31', issued: '2025-11-11' } });
  assert.equal((await services.fetchLicenseStatus()).kind, 'active');
});

test('expired, missing and invalid license states never become active', async () => {
  for (const [response, kind] of [
    [{ code: 200, val: { status: 'inactive', expired: '2000-01-01' } }, 'inactive'],
    [{ code: 404 }, 'missing'],
    [{ code: 500, val: 'read failed' }, 'error'],
    [{ code: 200, val: { status: 'string' } }, 'error'],
  ]) {
    handler = () => response;
    assert.equal((await services.fetchLicenseStatus()).kind, kind);
  }
});

test('transport errors are propagated to the screen', async () => {
  handler = () => ({ code: 500, bridge_error: true, message: '관리자 접근 필요' });
  await assert.rejects(services.fetchLicenseStatus(), /관리자 접근 필요/);
});

test('a license query failure does not become an instruction to register again', async () => {
  handler = () => ({ code: 500, bridge_error: true, message: '라이선스 상태 조회 실패' });
  await assert.rejects(services.fetchDeployStatus(), /라이선스 상태 조회 실패/);
});

test('infrastructure card uses current DC and actual CCVM running node', async () => {
  handler = () => ({ code: 200, val: { health: 'ok', online_nodes: ['cube1', 'cube2'], offline_nodes: [],
    ccvm_running_node: 'cube2', current_dc: 'cube1', resource_started: true } });
  const result = await services.fetchCloudClusterStatus();
  assert.equal(result.executionNode, 'cube2');
  assert.equal(result.currentDc, 'cube1');
  assert.equal(result.clusterStatus, 'HEALTH_OK');
});

test('bridge jobs return the actual final result after polling', async () => {
  let polls = 0;
  handler = (request) => request.path.endsWith('/_tasks/fixture')
    ? { job: ++polls > 1 ? { status: 'succeeded', result: { code: 200, val: 'completed' } } : { status: 'running' } }
    : { code: 202, bridge_job: 'fixture' };
  assert.deepEqual(await services.requestCubeApi('/api/v1/cube/scvm/bootstrap', { method: 'POST' }), { code: 200, val: 'completed' });
  assert.equal(polls, 2);
});

test('failed bootstrap jobs propagate the server guidance', async () => {
  handler = (request) => request.path.includes('/_tasks/')
    ? { job: { status: 'failed', message: '스토리지 네트워크 구성을 확인해 주세요.' } }
    : { code: 202, bridge_job: 'fixture' };
  await assert.rejects(services.requestCubeApi('/api/v1/cube/scvm/bootstrap', { method: 'POST' }), /스토리지 네트워크/);
});

test('every wizard receives only user bridges and preserves carrier state', async () => {
  handler = () => ({ code: 200, val: { bridges: ['bridge0', 'virbr0', 'lo'].map((DEVICE) => ({DEVICE, TYPE: 'bridge', STATE: 'connected'})),
    ethernets: [{ DEVICE: 'eno1', TYPE: 'ethernet', STATE: 'connected', PCI: '0000:01:00.0' }] } });
  const inventory = await services.fetchNicInventory();
  assert.deepEqual(inventory.bridges.map((item) => item.value), ['', 'bridge0']);
  assert.match(inventory.passthroughNics[0].label, /connected/);
});
