// Exercise the real wizard with simulated host responses; no host operations run.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp(path.join(os.tmpdir(), 'cluster-profile-ui-'));
const profile = {clusterConfig:{type:'ablestack-hci',hostType:'new',ccvm:{ip:'192.0.2.10'},
  mngtNic:{cidr:'24',gw:'192.0.2.254',dns:'192.0.2.254'},hosts:[1,2,3].map(i=>({index:String(i),
    hostname:'ablecube'+i,ablecube:'192.0.2.'+i,scvmMngt:'192.0.2.'+(10+i),
    ablecubePn:'198.51.100.'+i,scvm:'198.51.100.'+(10+i),scvmCn:'203.0.113.'+(10+i)}))},
  custom:{site:'기존 프로파일'}};
const registration = (host) => ({format:'ablestack-cube-enrollment-v1', host, digest:'a'.repeat(64),
  bundles:{[host]:{'agent.json':'{}', 'ca.crt':'fixture CA', 'node.crt':'fixture certificate', 'node.key':'fixture key'}}});
const upload = (field, name, value) => field.setInputFiles({name, mimeType:'application/json',
  buffer:Buffer.from(JSON.stringify(value))});
await build({absWorkingDir:frontend,stdin:{contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import '@patternfly/patternfly/patternfly.css';import './src/status/status.scss';
  import Wizard from './src/wizard/cluster-config-prepare-wizard.tsx';
  createRoot(document.getElementById('app')).render(<Wizard isOpen onClose={()=>{}} />);
`,resolveDir:frontend,loader:'tsx'},bundle:true,outfile:path.join(output,'app.js'),platform:'browser',
  loader:{'.woff2':'file','.woff':'file','.ttf':'file','.svg':'file'},
  plugins:[sassPlugin({silenceDeprecations:['legacy-js-api','import','global-builtin','color-functions']}),
    {name:'fixture-cockpit',setup(builder){
      builder.onLoad({filter:/platform\/cockpit\.ts$/},()=>({contents:'export default window.__fixtureCockpit;',loader:'ts'}));
    }}]});
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="ko" class="pf-v6-theme-dark"><head>
<meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="app"></div><script>
window.__profile=${JSON.stringify(profile)};window.__fileReads=[];window.__requests=[];
window.__savedProfile={...window.__profile,custom:{site:'서버에 저장된 최신 프로파일'}};
window.__fixtureCockpit={file(path){window.__fileReads.push(path);return {read:()=>Promise.resolve(null)};},
spawn(argv){if(argv[0]==='hostname')return Promise.resolve(argv[1]==='-I'?'192.0.2.1':'ablecube1');
let resolve;const job=new Promise(done=>resolve=done);job.input=payload=>{
const request=JSON.parse(payload);window.__requests.push(request);let response={code:200};
if(request.path==='/api/v1/cube/system/config')response={code:200,val:{ui:{}}};
if(request.path.includes('_tasks')||request.path==='/api/v1/cube/deploy/jobs')response={code:200,jobs:[]};
if(request.path==='/api/v1/cube/ssh/key')response={code:200,content:btoa('fixture bundle'),private_key:'fixture private',public_key:'fixture public'};
if(request.path==='/api/v1/cube/deploy/run')response={code:200,job_id:'fixture-job',status:'succeeded',steps:[{name:'cluster_apply',status:'succeeded'}]};
if(request.path==='/api/v1/cube/cluster/config')response=location.hash==='#missing'?{}:location.hash==='#error'?
 {code:500,bridge_error:true,message:'저장된 프로파일 조회 실패'}:window.__savedProfile;
if(request.path==='/api/v1/cube/downloads')response={code:200,files:[]};
resolve(JSON.stringify(response));};return job;}};
</script><script src="app.js"></script></body></html>`);

const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  for(const scenario of ['saved','missing','error']) {
    await page.goto('about:blank');
    await page.goto(pathToFileURL(path.join(output,'index.html')).href+'#'+scenario);
    const dialog=page.getByRole('dialog',{name:'클러스터 구성 준비 마법사',exact:true});
    await dialog.waitFor();
    const next=dialog.getByRole('button',{name:'다음',exact:true});
    for(let i=0;i<3;i++)await next.click();
    assert.equal(await dialog.locator('#host-registration').count(),0);
    await dialog.locator('#hosts-file-existing').check();
    const groups = [
      dialog.locator('.pf-v6-c-form__group').filter({has:page.locator('#hosts-file-new')}),
      dialog.locator('.pf-v6-c-form__group').filter({has:page.locator('#host-registration')}),
      dialog.locator('.pf-v6-c-form__group').filter({has:page.locator('#hosts-file')}),
    ];
    assert.deepEqual(await Promise.all(groups.map(group=>group.locator('.pf-v6-c-form__label-text').innerText())),
      ['구성 파일 준비 방식','호스트 통신 등록 파일','클러스터 구성 파일 (cluster.json)']);
    const positions = await Promise.all(groups.map(group=>group.boundingBox()));
    assert.ok(positions[0].y<positions[1].y && positions[1].y<positions[2].y);
    if(scenario==='saved')await page.screenshot({path:path.join(output,'existing-profile-upload-order.png'),fullPage:true});
    await dialog.locator('#hosts-file-new').check();
    assert.equal(await dialog.locator('#host-registration').count(),0);
    assert.equal(await dialog.locator('#hosts-file').count(),0);
    await dialog.locator('#hosts-file-existing').check();
    const registrationField = dialog.locator('#host-registration');
    const profileField = dialog.locator('#hosts-file');
    const uploadNotice = (message) => dialog.locator('.pf-v6-c-alert__title').filter({hasText:message});
    if (scenario === 'saved') {
      await upload(profileField, 'ablecube3.cube-agent.json', registration('ablecube3'));
      await uploadNotice("'cluster.json' 파일만 업로드할 수 있습니다.").waitFor();
      assert.equal(await next.isDisabled(), true);
      assert.equal(await profileField.getAttribute('aria-invalid'), 'true');
      await upload(profileField, 'cluster.json', registration('ablecube3'));
      await uploadNotice('클러스터 구성 파일을 읽을 수 없습니다. cluster.json 형식을 확인해 주세요.').waitFor();
      assert.equal(await next.isDisabled(), true);
    }
    await upload(profileField, 'cluster.json', profile);
    await dialog.locator('.ct-file-attach strong').filter({hasText:'cluster.json'}).waitFor();
    if (scenario === 'saved') {
      await upload(registrationField, 'ablecube2.cube-agent.json', registration('ablecube2'));
      await uploadNotice("현재 호스트용 'ablecube1.cube-agent.json' 파일을 선택해 주세요.").waitFor();
      assert.equal(await next.isDisabled(), true);
      assert.equal(await registrationField.getAttribute('aria-invalid'), 'true');
      await upload(registrationField, 'ablecube1.cube-agent.json', registration('ablecube2'));
      await uploadNotice('파일에 기록된 호스트가 현재 호스트(ablecube1)와 다릅니다').waitFor();
      assert.equal(await next.isDisabled(), true);
      await upload(registrationField, 'ablecube1.cube-agent.json', registration('ablecube1'));
      await uploadNotice('파일에 기록된 호스트가 현재 호스트').waitFor({state:'hidden'});
    }
    await next.click();
    await next.click();
    await dialog.getByRole('button',{name:'구성',exact:true}).click();
    await dialog.getByText('ABLESTACK 클러스터 구성을 위한 모든 설정이 완료되었습니다.',{exact:true}).waitFor();
    const download=dialog.locator('a[download="cluster.json"]');
    if(scenario==='saved') {
      const request = await page.evaluate(() => window.__requests.find(item => item.path === '/api/v1/cube/deploy/run'));
      assert.equal(request.body.enrollment.registration.host, 'ablecube1');
      await download.waitFor();
      const href=await download.getAttribute('href');
      const document=JSON.parse(decodeURIComponent(href.slice(href.indexOf(',')+1)));
      assert.deepEqual(document,await page.evaluate(()=>window.__savedProfile));
      assert.equal(await dialog.getByText(/파일이 비어 있습니다/).count(),0);
      await page.screenshot({path:path.join(output,'saved-profile-download.png'),fullPage:true});
    } else {
      await dialog.getByText(scenario==='missing'?'저장된 클러스터 구성 프로파일을 읽을 수 없습니다.':'저장된 프로파일 조회 실패',{exact:true}).waitFor();
      assert.equal(await download.count(),0);
    }
    assert.deepEqual(await page.evaluate(()=>window.__fileReads),[]);
    assert.ok(await page.evaluate(()=>window.__requests.some(request=>request.path==='/api/v1/cube/cluster/config')));
  }
  assert.deepEqual(errors,[]);
  console.log('Profile input order, mode switching, existing upload, saved download, and read errors passed.');
  console.log('Screenshots: '+output);
} catch(error) {
  await page.screenshot({path:path.join(output,'failed.png'),fullPage:true}).catch(()=>{});
  console.error((await page.locator('body').innerText()).slice(-2200));
  console.error('Screenshots: '+output);
  throw error;
} finally { await browser.close(); }
