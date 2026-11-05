// Real browser checks with fixture collector responses. No host/VM commands are executed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { bundleModule } from './helpers/bundle.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const captures = process.env.REACT_SCREENSHOTS || '/private/tmp/ablestack-react-screenshots';
await mkdir(captures, { recursive: true });
const preview = await bundleModule("export { getPreviewCubeApiResponse } from './src/services/api/preview.ts';");
const paths = ['/api/v1/cube/deploy/status', '/api/v1/cube/license', '/api/v1/cube/gluecluster/status',
  '/api/v1/cube/scvm/status', '/api/v1/cube/ccvm/status', '/api/v1/cube/infrastructure/status',
  '/api/v1/cube/gfs/resource/status', '/api/v1/cube/gfs/disk/status'];
const catalog = JSON.parse(execFileSync('python3', ['-c', "import sys,json;sys.path.insert(0,'python/react_bridge');from glue_catalog import catalog;print(json.dumps(catalog()))"], { cwd: root }));
const server = createServer(async (request, response) => {
  const filename = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  console.log('Launching Chrome for the local React page');
  browser = await chromium.launch({ headless: true,
    timeout: 20000,
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  for (const [product, expectedCards] of [['hci', 4], ['filesystem', 6], ['ablestack-vm', 4], ['standalone', 1], ['scvm', 1]]) {
    console.log(product + ': checking dashboard');
    globalThis.window = { location: { search: `?preview=1&product=${product}` } };
    const responses = Object.fromEntries(paths.map((path) => [path, preview.getPreviewCubeApiResponse(path)]));
    responses['/api/v1/cube/_tasks'] = { code: 200, jobs: [] };
    responses['/api/v1/cube/system/context'] = { code: 200, role: product === 'scvm' ? 'scvm' : 'host', hostname: product === 'scvm' ? 'scvm1' : 'ablecube1' };
    responses['/api/v1/cube/glue/catalog'] = { code: 200, services: catalog };
    responses['/api/v1/cube/deploy/jobs'] = { code: 200, jobs: [] };
    responses['/api/v1/version'] = { code: 200, os_version: 'Europa' };
    responses['/api/v1/cube/system/config'] = { code: 200, val: { bootstrap: { ccvm: 'true', scvm: 'true' }, ui: { scvm_lun_passthrough: false } } };
    for (const suffix of ['/api/v1/cube/nics?action=detail', '/api/v1/cube/disk?action=list', '/api/v1/cube/disk?action=gfs', '/api/v1/cube/cluster/config']) {
      responses[suffix] = preview.getPreviewCubeApiResponse(suffix);
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); console.error(product + ' runtime:', error.stack); });
    await page.route('**/base1/cockpit.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
      window.__responses = ${JSON.stringify(responses)};
      window.__requests = [];
      window.__permission = { allowed: true, callbacks: [], addEventListener(_, fn) { this.callbacks.push(fn); }, removeEventListener() {} };
      window.cockpit = {
        permission() { return window.__permission; }, gettext(text) { return text; },
        spawn(argv, options) {
          if (argv[0] === 'hostname') return Promise.resolve('ablecube1');
          let resolve;
          const process = new Promise((done) => resolve = done);
          process.input = function (payload) {
            const request = JSON.parse(payload);
            window.__requests.push({ argv, options, request });
            let response = window.__responses[request.path];
            if (request.path === '/api/v1/cube/license' && request.body.action === 'register') response = { code: 200, val: 'registered' };
            if (request.path === '/api/v1/cube/system/config' && request.method === 'POST') response = { code: 200 };
            if (request.path === '/api/v1/cube/local/manage') response = {code: 200, val: 'fixture local storage configured'};
            if (request.path === '/api/v1/cube/glue/service') response = { code: 200, val: request.body.action === 'list' ? [{ name: 'fixture', status: 'running' }] : [] };
            resolve(JSON.stringify(response || { code: 500, bridge_error: true, message: 'Unknown test route: ' + request.path }));
          };
          return process;
        }, file(filename) { return { read() { return Promise.resolve(filename.endsWith('cluster.json') ? JSON.stringify({ clusterConfig: { type: 'ablestack-hci', hosts: [{index: '1', hostname: 'ablecube1', ablecube: '10.10.1.1', scvmMngt: '10.10.1.11', ablecubePn: '100.100.1.1', scvm: '100.100.1.11', scvmCn: '100.200.1.11'}], ccvm: {ip:'10.10.1.10'}, mngtNic: {cidr:'24',gw:'10.10.1.254',dns:'8.8.8.8'} } }) : 'fixture'); }, close() {} }; }
      };` }));
    await page.goto(origin + '/react.html');
    await page.waitForFunction((count) => document.querySelectorAll('.ct-status-card').length === count, expectedCards);
    assert.equal(await page.getByRole('button', { name: '카드 메뉴 열기' }).count(), product === 'scvm' ? 0 : expectedCards, 'host status card operation menus are available');
    await page.getByRole('button', { name: '라이선스 관리', exact: true }).click();
    await page.getByText('라이선스가 등록되어 있습니다.', { exact: true }).waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: 'license.dat', mimeType: 'text/plain', buffer: Buffer.from('fixture license') });
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByText('라이선스가 성공적으로 등록되었습니다.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await page.locator('.ct-license-management-modal').waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => window.__requests.every((call) => call.options.superuser === 'require')));
    if (product !== 'scvm') assert.ok(await page.evaluate(() => window.__requests.some((call) => call.request.path === '/api/v1/cube/system/config')));
    assert.equal(await page.locator('option[value="open_deploy_run"]').count(), 0, 'all-in-one toolbar entry is suspended');
    if (product === 'scvm') {
      for (const service of catalog) {
        await page.getByRole('navigation', { name: '스토리지 서비스 메뉴' }).getByRole('button', { name: service.title, exact: true }).click();
        await page.getByRole('table', { name: service.title + ' 목록' }).waitFor();
        for (const action of service.actions.filter((action) => action.method !== 'GET')) {
          await page.locator('#service-action-' + service.id).selectOption(action.id);
          assert.equal(await page.locator('#service-confirm').count(), 1, 'all storage mutations require confirmation');
          assert.equal(await page.getByRole('button', { name: action.label, exact: true }).isDisabled(), true);
          assert.equal(await page.locator('.ct-storage-services__form .pf-v6-c-form__group').count(), action.fields.length + 1);
        }
      }
      await page.getByRole('navigation', { name: '스토리지 서비스 메뉴' }).getByRole('button', { name: 'GlueFS', exact: true }).click();
      await page.locator('#service-action-gluefs').selectOption('create');
      await page.locator('#field-name').fill('fixture-fs');
      await page.locator('#service-confirm').check();
      await page.getByRole('button', { name: '파일시스템 생성', exact: true }).click();
      await page.locator('.pf-v6-c-alert__title').filter({ hasText: '파일시스템 생성 작업이 완료되었습니다.' }).waitFor();
      await page.screenshot({ path: path.join(captures, 'scvm-services.png'), fullPage: true });
      assert.deepEqual(errors, [], 'SCVM: all storage forms and a creation flow render without exceptions');
      console.log('scvm: all service forms, confirmation and creation passed');
      await page.close(); continue;
    }
    await page.waitForFunction(() => document.querySelector('.ct-deploy-details')?.open === false);
    await page.screenshot({ path: path.join(captures, product + '-light.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('pf-v6-theme-dark'));
    await page.screenshot({ path: path.join(captures, product + '-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 2285, height: 1123 });
    const wideCards = await page.locator('.ct-status-card').evaluateAll((cards) => cards.map((card) => {
      const { x, y, width } = card.getBoundingClientRect();
      return { x, y, width };
    }));
    assert.equal(new Set(wideCards.map((card) => Math.round(card.y))).size, Math.ceil(expectedCards / 2), 'wide screens keep two cards per row');
    if (expectedCards > 1) {
      assert.ok(Math.abs(wideCards[0].width - wideCards[1].width) < 1, 'columns share the available width equally');
      assert.ok(wideCards[1].x > wideCards[0].x, 'second card is in the right column');
      assert.ok(wideCards[2].y > wideCards[0].y, 'third card starts the second row');
    }
    await page.screenshot({ path: path.join(captures, product + '-wide.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    if (product === 'filesystem') {
      await page.locator('.ct-status-card').last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(captures, product + '-gfs.png') });
    }
    if (product === 'hci') {
      for (const [action, title] of [
        ['prepare_cluster_config', '클러스터 구성 준비 마법사'],
        ['deploy_storage_vm', '스토리지센터 가상머신 배포 마법사'],
        ['deploy_cloud_vm', '클라우드센터 가상머신 배포 마법사'],
      ]) {
        await page.getByLabel('배포·운영 작업', { exact: true }).selectOption(action);
        const dialog = page.getByRole('dialog', { name: title, exact: true });
        await dialog.waitFor();
        const next = dialog.getByRole('button', { name: '다음', exact: true });
        await next.click();
        await page.screenshot({ path: path.join(captures, action + '.png'), fullPage: true });
        if (action === 'prepare_cluster_config') {
          await next.click();
          await next.click();
          await dialog.locator('#hosts-file-existing').check();
          const registration = dialog.locator('.ct-file-attach').filter({has: page.locator('#host-registration')});
          const clusterFile = dialog.locator('.ct-file-attach').filter({has: page.locator('#hosts-file')});
          assert.equal(await registration.getByRole('button', {name: '초기화', exact: true}).isDisabled(), true);
          await dialog.locator('#host-registration').setInputFiles({name: 'ablecube1.cube-agent.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({format: 'ablestack-cube-enrollment-v1', host: 'ablecube1', bundles: {}}))});
          await registration.locator('strong').filter({hasText: 'ablecube1.cube-agent.json'}).waitFor();
          await dialog.locator('#hosts-file').setInputFiles({name: 'cluster.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(responses['/api/v1/cube/cluster/config']))});
          await clusterFile.locator('strong').filter({hasText: 'cluster.json'}).waitFor();
          assert.equal(await registration.locator('.ct-file-attach__surface').evaluate((node) => getComputedStyle(node).borderRadius),
            await clusterFile.locator('.ct-file-attach__surface').evaluate((node) => getComputedStyle(node).borderRadius), 'both uploads share the same control');
          const prepareLabel = dialog.locator('.pf-v6-c-form__group').filter({has: page.locator('#hosts-file-new')}).locator('.pf-v6-c-form__label-text');
          assert.equal(await prepareLabel.locator('br').count(), 1, 'file preparation label breaks into two lines');
          assert.ok(await prepareLabel.evaluate((node) => node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight)), 'the complete label occupies two visible lines');
          assert.equal(await dialog.getByText('노드 IP 기준', {exact: true}).count(), 0);
          const helpText = 'PCS 클러스터 노드 주소로 사용할 IP 항목을 선택합니다.';
          assert.equal(await page.getByText(helpText, {exact: true}).count(), 0, 'help text stays out of the form until requested');
          await dialog.getByRole('button', {name: '클러스터 관리 네트워크 도움말', exact: true}).hover();
          await page.getByRole('tooltip').filter({hasText: helpText}).waitFor();
          await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="tooltip"]')).some((node) => Number(getComputedStyle(node).opacity) === 1));
          await page.screenshot({path: path.join(captures, 'cluster-file-uploads-and-tooltip.png')});
          await page.mouse.move(0, 0);
          await page.getByRole('tooltip').waitFor({state: 'hidden'});
          await registration.getByRole('button', {name: '초기화', exact: true}).click();
          await registration.locator('strong').filter({hasText: '선택된 호스트 등록 파일 없음'}).waitFor();
          assert.equal(await registration.getByRole('button', {name: '초기화', exact: true}).isDisabled(), true);
          await dialog.locator('#host-registration').setInputFiles({name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}')});
          await dialog.locator('.pf-v6-c-alert__title').filter({hasText: '호스트 통신 등록 파일 형식을 확인해 주세요.'}).waitFor();
          await registration.getByRole('button', {name: '초기화', exact: true}).click();
          assert.equal(await dialog.locator('.pf-v6-c-alert__title').filter({hasText: '호스트 통신 등록 파일 형식을 확인해 주세요.'}).count(), 0);
        }
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        if (action !== 'prepare_cluster_config') {
          const cancel = page.getByRole('dialog', { name: /배포 취소 확인/ });
          await cancel.waitFor();
          await cancel.getByRole('button', { name: '실행', exact: true }).click();
          await cancel.waitFor({ state: 'hidden' });
        }
        await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(errors, [], title + ': opening, next and cancel have no runtime exceptions');
        await page.getByRole('button', { name: '상태 새로고침', exact: true }).waitFor();
      }
      for (const ui of [{}, {cluster_type_powerflex: true}, {cluster_type_hci_filesystem: true},
        {cluster_type_powerflex: true, cluster_type_hci_filesystem: true},
        {cluster_type_powerflex: false, cluster_type_hci_filesystem: false}]) {
        await page.evaluate((ui) => { window.__responses['/api/v1/cube/system/config'].val.ui = ui; }, ui);
        await page.getByLabel('배포·운영 작업', { exact: true }).selectOption('prepare_cluster_config');
        const wizard = page.getByRole('dialog', {name: '클러스터 구성 준비 마법사', exact: true});
        await wizard.getByRole('button', {name: '다음', exact: true}).click();
        const expected = 3 + Number(ui.cluster_type_powerflex === true) + Number(ui.cluster_type_hci_filesystem === true);
        await page.waitForFunction((expected) => document.querySelectorAll('.ct-cluster-config-wizard__type-card').length === expected, expected);
        assert.equal(await wizard.locator('.ct-cluster-config-wizard__type-card').filter({hasText: 'PowerFlex'}).count(), Number(ui.cluster_type_powerflex === true));
        assert.equal(await wizard.locator('.ct-cluster-config-wizard__type-card').filter({hasText: 'ABLESTACK-HCI-Filesystem'}).count(), Number(ui.cluster_type_hci_filesystem === true));
        assert.equal(await wizard.getByText(/ABLESTACK HCI Filesystem은 Glue/).count(), Number(ui.cluster_type_hci_filesystem === true));
        await page.screenshot({path: path.join(captures, 'cluster-types-' + expected + '-' + Boolean(ui.cluster_type_powerflex) + '.png')});
        await wizard.getByRole('button', {name: 'Close', exact: true}).click();
        await wizard.waitFor({state: 'hidden'});
      }
      for (const kind of ['scvm', 'ccvm']) {
        await page.evaluate((kind) => {
          const id = 'a'.repeat(32);
          window.__responses['/api/v1/cube/' + kind + '/bootstrap'] = {code: 202, bridge_job: id};
          window.__responses['/api/v1/cube/_tasks/' + id] = {code: 200, job: {status: 'running'}};
          window.__responses['/api/v1/cube/_tasks'] = {code: 200, jobs: [{job_id: id, status: 'running', message: '구성 작업을 진행합니다.', logs: ['Glue 구성 스크립트를 실행합니다.']}]};
        }, kind);
        if (!await page.locator('.ct-deploy-details').evaluate((node) => node.open)) {
          await page.locator('.ct-deploy-details > summary').click();
        }
        const title = kind === 'scvm' ? '스토리지센터 구성' : '클라우드센터 구성';
        await page.locator('.ct-deploy-ribbon__stage').filter({has: page.getByText(title, {exact: true})}).click();
        const dialog = page.getByRole('dialog', { name: title, exact: true });
        await dialog.getByRole('button', { name: '구성', exact: true }).click();
        await dialog.locator('pre').filter({hasText: 'Glue 구성 스크립트를 실행합니다.'}).waitFor();
        assert.ok(await page.evaluate((kind) => window.__requests.some((call) =>
          call.request.path === '/api/v1/cube/' + kind + '/bootstrap' && call.request.body.run_script === true), kind), 'center configuration starts its bootstrap');
        await page.evaluate(() => { window.__responses['/api/v1/cube/_tasks/' + 'a'.repeat(32)] = {code: 200, job: {status: 'succeeded', result: {code: 200}}}; });
        await dialog.getByRole('button', { name: '닫기', exact: true }).click();
        await dialog.waitFor({state: 'hidden'});
        await page.evaluate(() => { window.__responses['/api/v1/cube/_tasks'] = {code: 200, jobs: []}; });
      }
      const completedStatus = structuredClone(responses['/api/v1/cube/deploy/status']);
      const taskTitle = (message) => page.locator('.pf-v6-c-alert__title').filter({hasText: message});
      const preparedStatus = structuredClone(completedStatus);
      Object.assign(preparedStatus.data.raw, {
        ccfg_status: 'true', scvm_status: 'not deployed', scvm_bootstrap_status: 'false', sc_status: '',
        ccvm_status: 'not deployed', ccvm_bootstrap_status: 'false', wall_monitoring_status: 'false',
      });
      Object.assign(preparedStatus.data, {stage: 'storage_vm_configure', message_key: 'storage_vm_not_deployed', available_actions: ['deploy_storage_vm']});
      await page.evaluate((status) => {
        window.__responses['/api/v1/cube/deploy/status'] = status;
        window.__responses['/api/v1/cube/_tasks'] = {code: 200, jobs: [{
          job_id: 'b'.repeat(32), status: 'running', message: '클러스터 구성 준비를 적용하고 있습니다.',
          logs: ['클러스터 구성과 호스트 통신 등록을 적용합니다.'],
        }]};
      }, preparedStatus);
      await page.getByRole('button', {name: '상태 새로고침', exact: true}).click();
      await page.locator('.ct-deploy-details[open] .ct-deploy-ribbon__stage--current').filter({hasText: '스토리지센터 가상머신 배포'}).waitFor();
      await taskTitle('클러스터 구성 준비를 적용하고 있습니다.').waitFor();
      await page.evaluate(() => {
        const task = window.__responses['/api/v1/cube/_tasks'].jobs[0];
        task.status = 'succeeded'; task.message = '클러스터 구성 준비가 완료되었습니다.';
      });
      await taskTitle('클러스터 구성 준비를 적용하고 있습니다.').waitFor({state: 'hidden'});
      assert.equal(await taskTitle('클러스터 구성 준비가 완료되었습니다.').count(), 0, 'successful task logs close automatically on the dashboard');
      assert.equal(await page.locator('.ct-deploy-details').evaluate((node) => node.open), true, 'cluster preparation does not collapse the remaining deployment steps');
      await page.screenshot({path: path.join(captures, 'cluster-prepare-success-next-step.png'), fullPage: true});
      // A fresh visit must also keep the next step visible without restoring a successful log banner.
      responses['/api/v1/cube/deploy/status'] = preparedStatus;
      responses['/api/v1/cube/_tasks'] = {code: 200, jobs: [{job_id: 'b'.repeat(32), status: 'succeeded', message: '클러스터 구성 준비가 완료되었습니다.', logs: []}]};
      await page.reload();
      await page.locator('.ct-deploy-details[open] .ct-deploy-ribbon__stage--current').filter({hasText: '스토리지센터 가상머신 배포'}).waitFor();
      await page.waitForFunction(() => window.__requests.some((call) => call.request.path === '/api/v1/cube/_tasks'));
      assert.equal(await taskTitle('클러스터 구성 준비가 완료되었습니다.').count(), 0, 'successful logs stay hidden after reload');
      await page.getByText('ABLESTACK 설치 및 구성 단계', {exact: true}).waitFor();
      for (const kind of ['scvm', 'ccvm']) {
        const status = structuredClone(kind === 'scvm' ? preparedStatus : completedStatus);
        const label = kind === 'scvm' ? '스토리지센터 가상머신 배포' : '클라우드센터 가상머신 배포';
        if (kind === 'ccvm') {
          Object.assign(status.data.raw, {ccvm_status: 'not deployed', ccvm_bootstrap_status: 'false', wall_monitoring_status: 'false'});
          Object.assign(status.data, {stage: 'cloud_vm_configure', message_key: 'cloud_vm_not_deployed', available_actions: ['deploy_cloud_vm']});
        }
        await page.evaluate((status) => { window.__responses['/api/v1/cube/deploy/status'] = status; }, status);
        await page.getByRole('button', {name: '상태 새로고침', exact: true}).click();
        const step = page.locator('.ct-deploy-ribbon__stage--current').filter({hasText: label});
        await step.waitFor();
        await page.screenshot({path: path.join(captures, kind + '-deployment-step.png')});
        const bootstrapCalls = await page.evaluate(() => window.__requests.filter((call) => call.request.path.endsWith('/bootstrap')).length);
        await step.click();
        const wizard = page.getByRole('dialog', {name: label + ' 마법사', exact: true});
        await wizard.waitFor();
        assert.equal(await page.getByRole('dialog', {name: kind === 'scvm' ? '스토리지센터 구성' : '클라우드센터 구성', exact: true}).count(), 0, 'deployment opens the VM wizard, not the bootstrap confirmation');
        await wizard.getByRole('button', {name: 'Close', exact: true}).click();
        const cancel = page.getByRole('dialog', {name: /배포 취소 확인/});
        await cancel.getByRole('button', {name: '실행', exact: true}).click();
        await wizard.waitFor({state: 'hidden'});
        assert.equal(await page.evaluate(() => window.__requests.filter((call) => call.request.path.endsWith('/bootstrap')).length), bootstrapCalls, 'opening the deployment wizard never starts bootstrap');
      }
      await page.evaluate(() => {
        window.__responses['/api/v1/cube/_tasks'] = {code: 200, jobs: [{
          job_id: 'c'.repeat(32), status: 'failed', message: '클러스터 구성 준비에 실패했습니다.', logs: ['호스트 연결 상태를 확인해 주세요.'],
        }]};
      });
      await taskTitle('클러스터 구성 준비에 실패했습니다.').waitFor();
      await page.getByText('호스트 연결 상태를 확인해 주세요.', {exact: true}).waitFor();
      await page.evaluate((status) => {
        window.__responses['/api/v1/cube/_tasks'] = {code: 200, jobs: []};
        window.__responses['/api/v1/cube/deploy/status'] = status;
      }, completedStatus);
      responses['/api/v1/cube/deploy/status'] = completedStatus;
      responses['/api/v1/cube/_tasks'] = {code: 200, jobs: []};
      await page.getByRole('button', {name: '상태 새로고침', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('.ct-deploy-details')?.open === false);
      await taskTitle('클러스터 구성 준비에 실패했습니다.').waitFor({state: 'hidden'});
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileColumns = await page.locator('.ct-status-card').evaluateAll((cards) => new Set(cards.map((card) => Math.round(card.getBoundingClientRect().x))).size);
      assert.equal(mobileColumns, 1, 'mobile cards use a single column');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page has no horizontal overflow');
      await page.screenshot({ path: path.join(captures, product + '-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.evaluate(() => { window.__responses['/api/v1/cube/ccvm/status'] = { code: 200, data: { State: 'not deployed' } }; });
      const previousVmQueries = await page.evaluate(() => window.__requests.filter((call) => call.request.path === '/api/v1/cube/ccvm/status').length);
      await page.getByRole('button', { name: '상태 새로고침' }).click();
      await page.waitForFunction((previous) => window.__requests.filter((call) => call.request.path === '/api/v1/cube/ccvm/status').length > previous, previousVmQueries);
      const card = page.locator('.ct-status-card').filter({ hasText: '클라우드센터 가상머신 상태' });
      await card.getByText('N/A', { exact: true }).first().waitFor();
      await page.evaluate(() => {
        const response = structuredClone(window.__responses['/api/v1/cube/deploy/status']);
        response.data.os_type = '';
        response.data.stage = 'cluster_config_prepare';
        response.data.raw.ccfg_status = 'false';
        response.data.message_key = 'cluster_config_required';
        response.data.available_actions = ['manage_license', 'download_config_file', 'prepare_cluster_config'];
        window.__responses['/api/v1/cube/deploy/status'] = response;
      });
      await page.getByRole('button', {name: '상태 새로고침', exact: true}).click();
      await page.getByText('다음 단계', {exact: true}).waitFor();
      assert.equal(await page.getByText('진행 필요', {exact: true}).count(), 0);
      assert.equal(await page.getByRole('button', {name: /올인원/}).count(), 0, 'all-in-one buttons stay hidden on an unfinished cluster');
      for (const viewport of [{width: 2260, height: 980}, {width: 1440, height: 560}, {width: 390, height: 844}]) {
        await page.setViewportSize(viewport);
        const toggle = page.getByRole('button', {name: '관리 도구', exact: true});
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click();
        const menu = page.locator('.ct-deploy-management-menu');
        await menu.getByRole('menuitem', {name: '설정파일 다운로드', exact: true}).waitFor();
        await menu.getByRole('menuitem', {name: '라이선스 관리', exact: true}).waitFor();
        await page.waitForFunction(() => {
          const menu = document.querySelector('.ct-deploy-management-menu');
          if (!menu) return false;
          const rect = menu.getBoundingClientRect();
          return Number(getComputedStyle(menu).opacity) === 1 && rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
        });
        assert.equal(await menu.evaluate((node) => node.closest('.pf-v6-c-page__main') === null), true, 'menu escapes the scroll container');
        assert.equal(await menu.evaluate((node) => node.scrollHeight <= node.clientHeight + 1), true, 'two menu items do not create an internal scrollbar');
        await page.screenshot({path: path.join(captures, 'management-menu-' + viewport.width + 'x' + viewport.height + '.png')});
        await page.keyboard.press('Escape');
        await menu.waitFor({state: 'hidden'});
      }
      await page.setViewportSize({width: 1440, height: 1100});
      await page.getByRole('button', {name: '관리 도구', exact: true}).click();
      await page.locator('.ct-deploy-management-menu').getByRole('menuitem', {name: '라이선스 관리', exact: true}).click();
      await page.getByText('라이선스가 등록되어 있습니다.', {exact: true}).waitFor();
      await page.getByRole('button', {name: '취소', exact: true}).click();
      await page.locator('.ct-license-management-modal').waitFor({state: 'hidden'});
      await page.evaluate(() => { window.__permission.allowed = false; window.__permission.callbacks.forEach((callback) => callback()); });
      await page.getByText('Cockpit에서 관리자 접근을 활성화해 주세요.').waitFor();
      assert.equal(await page.locator('.ct-status-card').count(), 0, 'revoked access removes all status cards');
    }
    if (product === 'standalone') {
      await page.evaluate(() => {
        const response = window.__responses['/api/v1/cube/deploy/status'];
        response.data.raw.local_configure = 'false';
        response.data.stage = 'local_storage_configure';
        response.data.message_key = 'local_storage_not_configured';
        response.data.available_actions = ['configure_local_storage'];
      });
      await page.getByRole('button', {name: '상태 새로고침', exact: true}).click();
      await page.locator('.ct-deploy-details[open]').waitFor();
      await page.getByRole('button', {name: '로컬 스토리지 구성', exact: true}).click();
      const dialog = page.getByRole('dialog', {name: '로컬 스토리지 구성', exact: true});
      assert.equal(await dialog.getByRole('button', {name: '구성', exact: true}).isDisabled(), true);
      await dialog.locator('#local-storage-disks').fill('/dev/disk/by-id/fixture-storage-disk');
      await dialog.locator('#local-storage-confirm').check();
      await dialog.getByRole('button', {name: '구성', exact: true}).click();
      await dialog.locator('.pf-v6-c-alert__title').filter({hasText: '로컬 스토리지 구성이 완료되었습니다.'}).waitFor();
      assert.ok(await page.evaluate(() => window.__requests.some((call) => call.request.path === '/api/v1/cube/local/manage')));
      await dialog.getByRole('button', {name: '닫기', exact: true}).click();
      await dialog.waitFor({state: 'hidden'});
    }
    assert.ok(await page.evaluate(() => window.__requests.every((call) => call.request.path !== '/api/v1/cube/deploy/run')), 'manual workflows never start all-in-one deployment');
    assert.deepEqual(errors, [], product + ': no runtime exceptions');
    console.log(product + ': dashboard, license registration, permissions and screenshots passed');
    await page.close();
  }
  console.log('Screenshots: ' + captures);
} finally {
  await browser?.close();
  server.close();
}
