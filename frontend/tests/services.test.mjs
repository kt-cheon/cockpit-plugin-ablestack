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
    export { fetchVersionInfo } from './src/services/api/version.ts';
    export { startCCVM, registerCCVMLicense, startAndRegisterCCVMLicense } from './src/services/api/cloud-vm-deploy.ts';
    export * from './src/services/api/license.ts';
    export { fetchCloudClusterStatus } from './src/services/api/cloud-cluster-status.ts';
    export { fetchDeployStatus } from './src/services/api/deploy-status.ts';
    export { fetchNicInventory, fetchStorageVmDiskInventory } from './src/services/api/inventory.ts';
    export { fetchUiFeatures, isClusterTypeVisible } from './src/services/api/system-config.ts';
    export { fetchVersionUpdateInfo, runVersionUpdate, fetchVersionUpdateLog } from './src/services/api/version-update.ts';
    export { fetchGfsStripeSize, saveGfsStripeSize, createGfsStorage } from './src/services/api/gfs-manage.ts';
    export { fetchClusterConfigDocument } from './src/services/api/cluster-config.ts';
    export { fetchDiskInitializationInventory, initializeDisks } from './src/services/api/disk-initialize.ts';
  `);
});

test('CCVM image preparation and guest readiness/license registration are separate awaited steps', async () => {
  const operations=[];
  handler=request=>{operations.push(request.path);return {code:200};};
  await services.startCCVM();
  assert.deepEqual(operations,['/api/v1/cube/ccvm/lifecycle']);
  await services.registerCCVMLicense();
  assert.deepEqual(operations,['/api/v1/cube/ccvm/lifecycle','/api/v1/cube/license/apply']);
  operations.length=0;
  handler=request=>{operations.push(request.path);return {code:500,message:'이미지 적재 실패'};};
  await assert.rejects(services.startAndRegisterCCVMLicense(),/이미지 적재 실패/);
  assert.deepEqual(operations,['/api/v1/cube/ccvm/lifecycle']);
});

test('OS version is retained when optional package metadata is unavailable', async () => {
  handler = request => {
    assert.equal(request.path, '/api/v1/version');
    return {code:200,os_version:'ABLESTACK Europa',kernel_version:'5.14.0-fixture',cockpit_version:'',
      errors:{cockpit_version:'RPM query failed'}};
  };
  const info = await services.fetchVersionInfo();
  assert.equal(info.osVersion, 'ABLESTACK Europa');
  assert.equal(info.osVersionError, '');
  handler = () => ({code:200,os_version:'',errors:{os_version:'OS release metadata is missing'}});
  assert.equal((await services.fetchVersionInfo()).osVersionError, 'OS release metadata is missing');
  handler = () => ({code:200,os_version:'ABLESTACK Europa v4.10.0',kernel_version:'',errors:{kernel_version:'uname failed'}});
  const partial = await services.fetchVersionInfo();
  assert.equal(partial.osVersion, 'ABLESTACK Europa v4.10.0');
  assert.equal(partial.kernelVersionError, 'uname failed');
});

test('cluster profile download reads the saved document through the backend API', async () => {
  const document = {clusterConfig:{type:'ablestack-hci',hosts:[{hostname:'cube1',ablecube:'192.0.2.1'}]},
    security:{internal_token:'fixture-only-token'},custom:{site:'기존 구성'}};
  for (const response of [document, {code:200,val:JSON.stringify(document)}, {data:document}]) {
    handler = (request) => {
      assert.equal(request.path, '/api/v1/cube/cluster/config');
      assert.equal(request.method, 'GET');
      return response;
    };
    assert.deepEqual(await services.fetchClusterConfigDocument(), document);
  }
});

test('missing cluster profile and backend read errors are not downloaded as empty documents', async () => {
  for (const response of [{}, {clusterConfig:null}, {code:500,val:'profile unavailable'}]) {
    handler = () => response;
    await assert.rejects(services.fetchClusterConfigDocument(), /프로파일/);
  }
  handler = () => ({code:500,bridge_error:true,message:'saved profile read failed'});
  await assert.rejects(services.fetchClusterConfigDocument(), /saved profile read failed/);
});

test('GFS stripe choice loads, saves numerically and follows the selected disks into creation', async () => {
  let saved = 128;
  handler = (request) => {
    assert.equal(request.path, '/api/v1/cube/gfs/manage');
    const body = request.body;
    if (body.action === 'set-gfs-settings') saved = body.stripe_size_kib;
    if (body.action === 'create-gfs') {
      assert.deepEqual(body.disks, ['/dev/sdb', '/dev/sdc', '/dev/sdd']);
      assert.equal(body.stripe_size_kib, 512);
      return {code: 200};
    }
    return {code: 200, val: {stripe_size_kib: saved}};
  };
  assert.equal(await services.fetchGfsStripeSize(), 128);
  for (const size of [64, 128, 256, 512]) {
    assert.equal(await services.saveGfsStripeSize(size), size);
    assert.equal(await services.fetchGfsStripeSize(), size);
  }
  await services.createGfsStorage(['/dev/sdb', '/dev/sdc', '/dev/sdd'], 512);
  handler = () => ({code: 500, val: 'GFS settings write failed'});
  await assert.rejects(services.saveGfsStripeSize(256), /GFS settings write failed/);
});

test('disk initialization sends each selected identity and requires the exact warning phrase', async () => {
  const devices=[{path:'/dev/sdb',identity:'one',label:'disk one'},{path:'/dev/sdc',identity:'two',label:'disk two'}];
  const before=fixture.calls.length;
  await assert.rejects(services.initializeDisks(devices,'확인했습니다'),/정확히/);
  assert.equal(fixture.calls.length,before);
  handler=request=>{
    assert.equal(request.path,'/api/v1/cube/disk/initialize');
    assert.equal(request.method,'POST');
    assert.deepEqual(request.body,{confirmation:'확인했습니다.',devices:[{path:'/dev/sdb',identity:'one'},{path:'/dev/sdc',identity:'two'}]});
    return {code:200,success:false,results:[{path:'/dev/sdb',status:'completed',message:'done'},
      {path:'/dev/sdc',status:'failed',message:'busy'}]};
  };
  const response=await services.initializeDisks(devices,'확인했습니다.');
  assert.equal(response.success,false);
  assert.equal(response.results[1].status,'failed');
});

test('Tools update checks and executes the separate Tools action', async () => {
  handler = (request) => {
    assert.equal(request.body.update_type, 'tools');
    return {code: 200, val: {update_type: 'tools', update_label: 'ABLESTACK Tools 업데이트',
      current_kernel: '5.14.0-new', target_kernel: '5.14.0-new',
      work_update_script: '/opt/ABLESTACK_UPDATE/update/update-qemu-exec-tools.sh',
      message: 'ABLESTACK Tools 업데이트 실행이 완료되었습니다.'}};
  };
  const info = await services.fetchVersionUpdateInfo('/opt/ABLESTACK_UPDATE', 'tools');
  assert.equal(info.updateType, 'tools');
  assert.equal(info.currentKernel, '5.14.0-new');
  assert.equal(info.targetKernel, '5.14.0-new');
  assert.match(info.workUpdateScript, /update-qemu-exec-tools\.sh$/);
  const result = await services.runVersionUpdate('/opt/ABLESTACK_UPDATE', 'tools');
  assert.equal(result.background, false);
});

test('background update start retains launch state and existing log path', async () => {
  handler = () => ({code: 200, val: {update_type: 'all', background: true,
    log_file: '/var/log/ablestack-update.log', message: '백그라운드에서 시작했습니다.'}});
  const result = await services.runVersionUpdate('/mnt/iso', 'all');
  assert.equal(result.background, true);
  assert.equal(result.logFile, '/var/log/ablestack-update.log');
  assert.match(result.message, /시작/);
});

test('unified RPM metadata preserves role-specific package lists', async () => {
  const roles = {host:['cloudstack-agent.x86_64','curl.noarch'],scvm:[],ccvm:['curl.noarch']};
  handler = () => ({code:200,val:{update_type:'all',rpm_only:true,package_count:2,role_packages:roles}});
  const info = await services.fetchVersionUpdateInfo('/mnt/unified', 'all');
  assert.equal(info.rpmOnly, true);
  assert.equal(info.packageCount, 2);
  assert.deepEqual(info.rolePackages, roles);
});

test('update log is read separately and keeps the Korean display returned by the helper', async () => {
  handler = (request) => {
    assert.equal(request.body.action, 'log');
    assert.equal(request.body.update_type, 'all');
    assert.equal(request.body.mount_path, undefined);
    return {code: 200, val: {log_file: '/var/log/ablestack-update.log',
      text: '[2026-11-17 09:45:33] 호스트 업데이트 완료'}};
  };
  const result = await services.fetchVersionUpdateLog('all');
  assert.equal(result.logFile, '/var/log/ablestack-update.log');
  assert.match(result.text, /호스트 업데이트 완료/);
});

test('Tools kernel mismatch is shown to the caller', async () => {
  handler = () => ({code: 500, val: '현재 커널 버전이 맞지 않아 설치할 수 없습니다.'});
  await assert.rejects(services.fetchVersionUpdateInfo('/mnt/iso', 'tools'), /현재 커널 버전/);
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

test('cancelled jobs stop polling and report the server guidance', async () => {
  let polls = 0;
  handler = (request) => request.path.includes('/_tasks/')
    ? {job: ++polls === 1 ? {status:'cancelling'} : {status:'cancelled',message:'작업을 중단했습니다. 실제 구성을 확인해 주세요.'}}
    : {code:202,bridge_job:'fixture'};
  await assert.rejects(services.requestCubeApi('/api/v1/cube/scvm/bootstrap',{method:'POST'}), /작업을 중단/);
  assert.equal(polls,2);
});

test('every wizard receives only user bridges and preserves carrier state', async () => {
  handler = () => ({ code: 200, val: { bridges: ['bridge0', 'virbr0', 'lo'].map((DEVICE) => ({DEVICE, TYPE: 'bridge', STATE: 'connected'})),
    ethernets: [{ DEVICE: 'eno1', TYPE: 'ethernet', STATE: 'connected', PCI: '0000:01:00.0' }] } });
  const inventory = await services.fetchNicInventory();
  assert.deepEqual(inventory.bridges.map((item) => item.value), ['', 'bridge0']);
  assert.match(inventory.passthroughNics[0].label, /connected/);
});

test('disk passthrough lists whole disks with capacity, hardware details and stable deployment paths', async () => {
  const disk = {name: 'sdb', kname: 'sdb', path: '/dev/disk/by-path/pci-data-disk', type: 'disk', size: '900G', wwn: 'private-wwn', vendor: ' ATA ', model: ' Fixture SSD '};
  handler = (request) => request.path.endsWith('/system/config') ? {code: 200, val: {ui: {}}} : {code: 200, val: {
    blockdevices: [
      {name: 'sda', kname: 'sda', path: '/dev/disk/by-path/pci-os-disk', type: 'disk', children: [
        {name: 'sda1', path: '/dev/sda1', type: 'part'},
        {name: 'sda2', path: '/dev/sda2', type: 'part', children: [{name: 'system-root', path: '/dev/mapper/system-root', type: 'lvm'}]},
      ]},
      disk, {...disk},
      {name: 'nvme0n1', kname: 'nvme0n1', path: '/dev/nvme0n1', type: 'disk', size: '1.8T', vendor: null, model: 'Fixture NVMe'},
      {name: 'sdc1', path: '/dev/sdc1', type: 'part'},
      {name: 'orphan-lv', path: '/dev/mapper/orphan-lv', type: 'lvm'},
      {name: 'mpathb', path: '/dev/mapper/mpathb', type: 'mpath', single_path: [{name: 'sdd', path: '/dev/sdd', type: 'disk'}]},
      {name: 'sr0', path: '/dev/sr0', type: 'rom'},
    ], raidcontrollers: [{Slot: '0000:18:00.0', Class: 'RAID bus controller', Vendor: 'Fixture'}],
  }};
  const before = fixture.calls.length;
  const inventory = await services.fetchStorageVmDiskInventory();
  assert.deepEqual(inventory.physicalDisks.map((disk) => disk.label), ['/dev/sda', '/dev/sdb · 900G · ATA Fixture SSD', '/dev/nvme0n1 · 1.8T · Fixture NVMe']);
  assert.deepEqual(inventory.physicalDisks.map((disk) => disk.value), ['/dev/disk/by-path/pci-os-disk', '/dev/disk/by-path/pci-data-disk', '/dev/nvme0n1']);
  assert.equal(inventory.physicalDisks[0].isDisabled, true);
  assert.equal(inventory.physicalDisks[1].isDisabled, false);
  assert.deepEqual(inventory.raidDisks.map((disk) => disk.value), ['0000:18:00.0']);
  assert.deepEqual(fixture.calls.slice(before).map((call) => call.request.path), ['/api/v1/cube/disk?action=list', '/api/v1/cube/system/config']);
});

test('disk passthrough cannot offer partitions or logical volumes as fallback candidates', async () => {
  handler = (request) => request.path.endsWith('/system/config') ? {code: 200, val: {}} : {code: 200, val: {
    blockdevices: [{name: 'sda1', path: '/dev/sda1', type: 'part'}, {name: 'root', path: '/dev/mapper/root', type: 'lvm'}],
  }};
  assert.deepEqual((await services.fetchStorageVmDiskInventory()).physicalDisks, []);
});

test('disks marked in use are disabled even when their partition list is empty', async () => {
  handler = (request) => request.path.endsWith('/system/config') ? {code: 200, val: {}} : {code: 200, val: {blockdevices: [
    {name: 'sdb', kname: 'sdb', path: '/dev/sdb', type: 'disk', children: [], in_use: true, in_use_reason: '이미 할당된 디스크'},
  ]}};
  const [disk] = (await services.fetchStorageVmDiskInventory()).physicalDisks;
  assert.equal(disk.label, '/dev/sdb');
  assert.equal(disk.isDisabled, true);
  assert.equal(disk.disabledReason, '이미 할당된 디스크');
});

test('existing configuration files with no UI flags hide optional products', async () => {
  for (const val of [{}, {ui: {}}, {ui: {cluster_type_powerflex: false, cluster_type_hci_filesystem: false}}]) {
    handler = () => ({code: 200, val});
    const features = await services.fetchUiFeatures();
    assert.equal(services.isClusterTypeVisible('powerflex', features), false);
    assert.equal(services.isClusterTypeVisible('ablestack-hci-filesystem', features), false);
    for (const type of ['ablestack-hci', 'ablestack-vm', 'ablestack-standalone']) {
      assert.equal(services.isClusterTypeVisible(type, features), true);
    }
  }
});

test('product visibility flags are independent and require JSON true', async () => {
  for (const [powerflex, filesystem] of [[true, false], [false, true], [true, true], ['false', 'true']]) {
    handler = () => ({code: 200, val: JSON.stringify({ui: {cluster_type_powerflex: powerflex, cluster_type_hci_filesystem: filesystem}})});
    const features = await services.fetchUiFeatures();
    assert.equal(services.isClusterTypeVisible('powerflex', features), powerflex === true);
    assert.equal(services.isClusterTypeVisible('ablestack-hci-filesystem', features), filesystem === true);
  }
});
