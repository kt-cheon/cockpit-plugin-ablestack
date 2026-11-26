// Fixture APIs only. No qemu-img, dd, VM, storage or license operation is executed.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sassPlugin} from 'esbuild-sass-plugin';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

const frontend=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(path.join(os.tmpdir(),'deployment-progress-ui-'));
await build({absWorkingDir:frontend,stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import '@patternfly/patternfly/patternfly.css';import './src/status/status.scss';
import Wizard from './src/wizard/cloud-vm-deploy-wizard.tsx';
createRoot(document.getElementById('app')).render(<Wizard isOpen clusterType={new URLSearchParams(location.search).get('kind')} onClose={()=>{}} />);
`,resolveDir:frontend,loader:'tsx'},bundle:true,outfile:path.join(output,'app.js'),platform:'browser',
loader:{'.woff2':'file','.woff':'file','.ttf':'file','.svg':'file'},
plugins:[sassPlugin({silenceDeprecations:['legacy-js-api','import','global-builtin','color-functions']}),
{name:'fixture',setup(builder){builder.onLoad({filter:/platform\/cockpit\.ts$/},()=>({contents:'export default window.__cockpit;',loader:'ts'}));}}]});
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="ko" class="pf-v6-theme-dark"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="app"></div><script>
window.__requests=[];window.__jobs={};window.__active='';
window.__kind=new URLSearchParams(location.search).get('kind');
window.__startJob=(id,message)=>{window.__active=id;window.__jobs[id]={job_id:id,status:'running',message,logs:[message],created_at:new Date().toISOString()};return {code:202,bridge_job:id};};
window.__cockpit={spawn(argv){if(argv[0]==='hostname')return Promise.resolve('cube1');let resolve;
const operation=new Promise(done=>resolve=done);operation.input=payload=>{const request=JSON.parse(payload);window.__requests.push(request);let response={code:200};
if(request.path==='/api/v1/cube/nics?action=detail')response={code:200,val:{bridges:[{DEVICE:'bridge0',STATE:'connected'}]}};
if(request.path==='/api/v1/cube/system/config')response={code:200,val:{ui:{}}};
if(request.path==='/api/v1/cube/cluster/config')response={clusterConfig:{type:window.__kind,hosts:[1,2,3].map(index=>({index:String(index),hostname:'cube'+index,ablecube:'192.0.2.'+index,ablecubePn:'198.51.100.'+index,scvmMngt:'192.0.2.'+(index+10),scvm:'198.51.100.'+(index+10),scvmCn:'203.0.113.'+index})),ccvm:{ip:'192.0.2.30'},mngtNic:{cidr:'24',gw:'192.0.2.254',dns:'192.0.2.53'}}};
if(request.path==='/api/v1/cube/ccvm/lifecycle'&&request.body.action==='start')response=window.__startJob('a'.repeat(32),'이미지 적재를 시작합니다.');
if(request.path==='/api/v1/cube/license/apply')response=window.__startJob('b'.repeat(32),'가상머신 초기 설정 완료를 기다리고 있습니다.');
if(request.path==='/api/v1/cube/_tasks')response={code:200,jobs:window.__active?[window.__jobs[window.__active]]:[]};
if(request.path.startsWith('/api/v1/cube/_tasks/'))response={code:200,job:window.__jobs[request.path.split('/').at(-1)]};
resolve(JSON.stringify(response));};return operation;}};
</script><script src="app.js"></script></body></html>`);

const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
for(const kind of ['ablestack-hci','ablestack-vm','ablestack-standalone']){
  await page.goto('about:blank');
  await page.goto(pathToFileURL(path.join(output,'index.html')).href+'?kind='+kind);
  const dialog=page.getByRole('dialog',{name:'클라우드센터 가상머신 배포 마법사',exact:true});
  const next=dialog.getByRole('button',{name:'다음',exact:true});
  await dialog.waitFor();await next.click();
  if(kind==='ablestack-vm')await next.click();
  await next.click();
  await dialog.locator('#cloud-vm-mgmt-bridge').selectOption('bridge0');
  await next.click();await next.click();
  await dialog.getByRole('button',{name:'구성',exact:true}).click();
  await page.getByRole('dialog',{name:'클라우드센터 가상머신 배포 진행 확인',exact:true}).getByRole('button',{name:'실행',exact:true}).click();
  await page.waitForFunction(()=>window.__active==='a'.repeat(32));
  const setup=dialog.locator('.ct-wizard-status-row').filter({hasText:'OS 이미지 적재 및 가상머신 시작'});
  const license=dialog.locator('.ct-wizard-status-row').filter({hasText:'가상머신 초기 설정 확인 및 라이선스 등록'});
  await setup.getByText('진행 중',{exact:true}).waitFor();
  await license.getByText('대기',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__requests.some(request=>request.path==='/api/v1/cube/license/apply')),false,'guest registration waits for image transfer');
  const storage=kind==='ablestack-hci'?'RBD':kind==='ablestack-vm'?'GFS2':'로컬 볼륨';
  await dialog.getByText(new RegExp('OS 이미지를 '+storage)).waitFor();
  await page.evaluate(storage=>{window.__jobs['a'.repeat(32)].logs.push('CCVM 이미지 '+storage+' 적재 · 35% · 경과 1분 0초 · 예상 남은 시간 약 1분 52초');},storage);
  await dialog.locator('pre').filter({hasText:'35%'}).waitFor();
  await page.screenshot({path:path.join(output,kind+'-image-progress.png'),fullPage:true});
  await page.evaluate(()=>{const task=window.__jobs['a'.repeat(32)];task.status='succeeded';task.result={code:200};task.logs.push('이미지 적재 · 100% · 완료');});
  await page.waitForFunction(()=>window.__active==='b'.repeat(32));
  await setup.getByText('완료',{exact:true}).waitFor();
  await license.getByText('진행 중',{exact:true}).waitFor();
  await dialog.getByText(/가상머신 부팅과 초기 설정이 완료되기를 기다린 후 라이선스를 등록합니다/).waitFor();
  await page.screenshot({path:path.join(output,kind+'-guest-initialization.png'),fullPage:true});
  await page.evaluate(()=>{const task=window.__jobs['b'.repeat(32)];task.status='succeeded';task.result={code:200};});
  await license.getByText('완료',{exact:true}).waitFor();
  await dialog.getByText('클라우드센터 가상머신 배포가 완료되었습니다.',{exact:true}).waitFor();
  console.log(kind+': transfer percentage, guidance and separate guest-registration step passed');
}
assert.deepEqual(errors,[]);
console.log('Screenshots: '+output);
}catch(error){await page.screenshot({path:path.join(output,'failed.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3500));console.error('Screenshots: '+output);throw error;
}finally{await browser.close();}
