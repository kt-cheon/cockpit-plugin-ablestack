// Render the real update modal with simulated backend responses only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(os.tmpdir(), 'ablestack-update-ui-'));
await build({
  absWorkingDir: frontend,
  stdin: {contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import '@patternfly/patternfly/patternfly.css';
    import './src/status/status.scss';
    import Modal from './src/status/ablestack-update-modal.tsx';
    createRoot(document.getElementById('app')).render(<Modal isOpen onClose={() => {}} onCompleted={(message) => window.__completed.push(message)} />);
  `, resolveDir: frontend, loader: 'tsx'},
  bundle: true, outfile: path.join(output, 'app.js'), platform: 'browser',
  loader: {'.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file'},
  plugins: [sassPlugin({silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions']}),
    {name: 'fixture-cockpit', setup(builder) {
      builder.onLoad({filter: /platform\/cockpit\.ts$/}, () => ({contents: 'export default window.__fixtureCockpit;', loader: 'ts'}));
    }}],
});
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body>
<div id="app"></div><script>
window.__completed=[]; window.__requests=[]; window.__kernelMismatch=false;
window.__fixtureCockpit={spawn(){let resolve;const process=new Promise(done=>resolve=done);process.input=function(payload){
  const request=JSON.parse(payload);window.__requests.push(request);const type=request.body?.update_type||'all';
  if(request.path==='/api/v1/version'){resolve(JSON.stringify({code:200,kernel_version:'5.14.0-new',os_version:'ABLESTACK Current'}));return;}
  if(type==='tools'&&window.__kernelMismatch){resolve(JSON.stringify({code:500,val:'현재 커널 버전(5.14.0-old)이 맞지 않아 설치할 수 없습니다. 대상 커널: 5.14.0-new'}));return;}
  const background=type==='all'&&request.body.action==='run';
  resolve(JSON.stringify({code:200,val:{mount_path:request.body.mount_path,copy_path:'/opt/ABLESTACK_UPDATE',
    current_ablestack_version:'ABLESTACK Current',target_ablestack_version:'ABLESTACK Next',
    current_kernel:'5.14.0-new',target_kernel:'5.14.0-new',update_type:type,
    work_update_script:'/opt/ABLESTACK_UPDATE/update/'+(type==='tools'?'update-qemu-exec-tools.sh':'update-all.sh'),
    background,log_file:'/var/log/ablestack-update.log',
    message:background?'전체 업데이트를 백그라운드에서 시작했습니다.':'ABLESTACK Tools 업데이트 실행이 완료되었습니다.'}}));
};return process;}};
</script><script src="app.js"></script></body></html>`);

const browser = await chromium.launch({headless: true, executablePath:
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
let page;
try {
  page = await browser.newPage({viewport: {width: 1280, height: 1100}});
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const open = async () => {
    await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
    await page.getByRole('dialog', {name: 'ABLESTACK 업데이트'}).waitFor();
  };
  await open();
  assert.equal(await page.locator('.ct-ablestack-update-modal__type-card').count(), 3);
  await page.getByRole('button', {name: /^ABLESTACK Tools 업데이트/}).click();
  assert.equal(await page.locator('#ablestack-update-mount-path').inputValue(), '/opt/ABLESTACK_UPDATE');
  await page.getByRole('button', {name: '버전 확인', exact: true}).click();
  await page.locator('.pf-v6-c-alert__title').filter({hasText: '업데이트 버전 확인이 완료되었습니다.'}).waitFor();
  assert.equal(await page.getByText('5.14.0-new', {exact: true}).count(), 2);
  await page.getByRole('switch', {name: '업데이트 실행 확인'}).press('Space');
  await page.getByRole('button', {name: '실행', exact: true}).click();
  await page.locator('.pf-v6-c-alert__title').filter({hasText: 'Tools 업데이트 실행이 완료'}).waitFor();
  await page.screenshot({path: path.join(output, 'tools-completed.png')});
  assert.equal(await page.evaluate(() => window.__requests.filter((r) => r.body?.action==='run' && r.body.update_type==='tools').length), 1);

  await open();
  await page.evaluate(() => window.__kernelMismatch = true);
  await page.getByRole('button', {name: /^ABLESTACK Tools 업데이트/}).click();
  await page.getByRole('button', {name: '버전 확인', exact: true}).click();
  await page.locator('.pf-v6-c-alert__title').filter({hasText: '현재 커널 버전'}).waitFor();
  assert.equal(await page.getByRole('button', {name: '실행', exact: true}).isDisabled(), true);
  await page.screenshot({path: path.join(output, 'tools-kernel-mismatch.png')});
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth), true);
  await page.screenshot({path: path.join(output, 'tools-mobile.png'), fullPage: true});

  await page.setViewportSize({width: 1280, height: 1100});
  await open();
  await page.locator('#ablestack-update-mount-path').fill('/mnt/iso');
  await page.getByRole('button', {name: '버전 확인', exact: true}).click();
  await page.locator('.pf-v6-c-alert__title').filter({hasText: '업데이트 버전 확인이 완료되었습니다.'}).waitFor();
  await page.getByRole('switch', {name: '업데이트 실행 확인'}).press('Space');
  await page.getByRole('button', {name: '실행', exact: true}).click();
  await page.locator('.pf-v6-c-alert__title').filter({hasText: '백그라운드에서 시작'}).waitFor();
  assert.equal(await page.locator('.ct-ablestack-update-modal__alert.pf-m-success').count(), 0);
  await page.screenshot({path: path.join(output, 'background-started.png')});
  assert.deepEqual(errors, []);
  console.log('Update modal: Tools install, kernel mismatch, background start, and mobile layout passed.');
  console.log('Screenshots: ' + output);
} catch (error) {
  if (page) {
    await page.screenshot({path: path.join(output, 'failed.png'), fullPage: true}).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(-2500));
  }
  console.error('Screenshots: ' + output);
  throw error;
} finally {
  await browser.close();
}
