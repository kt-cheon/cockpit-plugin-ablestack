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
      for (const kind of ['scvm', 'ccvm']) {
        await page.evaluate((kind) => {
          const id = 'a'.repeat(32);
          window.__responses['/api/v1/cube/' + kind + '/bootstrap'] = {code: 202, bridge_job: id};
          window.__responses['/api/v1/cube/_tasks/' + id] = {code: 200, job: {status: 'running'}};
          window.__responses['/api/v1/cube/_tasks'] = {code: 200, jobs: [{job_id: id, status: 'running', message: '구성 작업을 진행합니다.', logs: ['Glue 구성 스크립트를 실행합니다.']}]};
        }, kind);
        await page.getByLabel('배포·운영 작업', { exact: true }).selectOption(kind === 'scvm' ? 'configure_storage_vm' : 'configure_cloud_vm');
        const dialog = page.getByRole('dialog', { name: kind === 'scvm' ? '스토리지센터 구성' : '클라우드센터 구성', exact: true });
        await dialog.getByRole('button', { name: '구성', exact: true }).click();
        await dialog.locator('pre').filter({hasText: 'Glue 구성 스크립트를 실행합니다.'}).waitFor();
        await page.evaluate(() => { window.__responses['/api/v1/cube/_tasks/' + 'a'.repeat(32)] = {code: 200, job: {status: 'succeeded', result: {code: 200}}}; });
        await dialog.getByRole('button', { name: '닫기', exact: true }).click();
        await dialog.waitFor({state: 'hidden'});
        await page.evaluate(() => { window.__responses['/api/v1/cube/_tasks'] = {code: 200, jobs: []}; });
      }
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
      await page.evaluate(() => { window.__permission.allowed = false; window.__permission.callbacks.forEach((callback) => callback()); });
      await page.getByText('Cockpit에서 관리자 접근을 활성화해 주세요.').waitFor();
      assert.equal(await page.locator('.ct-status-card').count(), 0, 'revoked access removes all status cards');
    }
    assert.deepEqual(errors, [], product + ': no runtime exceptions');
    console.log(product + ': dashboard, license registration, permissions and screenshots passed');
    await page.close();
  }
  console.log('Screenshots: ' + captures);
} finally {
  await browser?.close();
  server.close();
}
