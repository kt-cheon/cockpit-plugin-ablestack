// The real GFS form and services run against fixture responses; no disks or hosts are touched.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const repo = path.dirname(frontend.replace(/\/$/, ''));
const output = await mkdtemp(path.join(os.tmpdir(), 'ablestack-gfs-stripes-'));
await build({
  absWorkingDir: frontend,
  stdin: {contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import '@patternfly/patternfly/patternfly.css';
    import Wizard from './src/wizard/gfs-storage-configure-wizard.tsx';
    createRoot(document.getElementById('app')).render(<Wizard isOpen onClose={()=>{}} />);
  `, resolveDir: frontend, loader: 'tsx'},
  bundle: true, outfile: path.join(output, 'app.js'), platform: 'browser', jsx: 'automatic',
  loader: {'.woff2':'file','.woff':'file','.ttf':'file','.svg':'file'},
  plugins: [sassPlugin({silenceDeprecations:['legacy-js-api','import','global-builtin','color-functions']}),
    {name:'fixture-cockpit',setup(builder) {
      builder.onLoad({filter:/platform\/cockpit\.ts$/},()=>({contents:'export default window.__fixtureCockpit;',loader:'ts'}));
    }}],
});
const fixture = `
window.__requests=[]; window.__failSave=false;
window.__fixtureCockpit={spawn(){let resolve;const p=new Promise(done=>resolve=done);p.input=function(payload){
  const r=JSON.parse(payload);window.__requests.push(r);let result={code:200};
  if(r.path==='/api/v1/cube/_tasks')result={jobs:[]};
  if(r.path==='/api/v1/cube/cluster/config')result={clusterConfig:{type:'ablestack-vm',hosts:[1,2,3].map(i=>({hostname:'fixture-host-'+i,ablecube:'192.0.2.'+i}))}};
  if(r.path.startsWith('/api/v1/cube/disk?'))result={code:200,val:{blockdevices:[1,2,3].map(i=>({id:'/dev/mapper/fixture-lun-'+i,path:'/dev/mapper/fixture-lun-'+i,name:'LUN '+i,size:'1 TiB',state:'running',type:'mpath',wwn:'fixture-wwn-'+i}))}};
  if(r.body.action==='get-gfs-settings')result={code:200,val:{stripe_size_kib:Number(localStorage.getItem('fixture-stripe-size')||128)}};
  if(r.body.action==='set-gfs-settings'){
    if(window.__failSave)result={code:500,val:'설정 저장 테스트 실패'};
    else{localStorage.setItem('fixture-stripe-size',r.body.stripe_size_kib);result={code:200,val:{stripe_size_kib:r.body.stripe_size_kib}};}
  }
  setTimeout(()=>resolve(JSON.stringify(result)),30);
};return p;}};`;
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="app"></div><script>${fixture}</script><script src="app.js"></script></body></html>`);

const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
let page;
const errors=[];
try {
  page=await browser.newPage({viewport:{width:1440,height:1080}});
  page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE ERROR: '+error.message);});
  const openDiskStep=async()=>{
    await page.getByRole('dialog',{name:'GFS 스토리지 구성 마법사'}).waitFor();
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.getByRole('radio',{name:'건너뛰기',exact:true}).check();
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.locator('#gfs-stripe-size-kib:enabled').waitFor();
  };
  await page.goto(pathToFileURL(path.join(output,'index.html')).href);
  await openDiskStep();
  const select=page.getByRole('combobox',{name:'Stripe당 데이터 블록 크기',exact:true});
  assert.equal(await select.inputValue(),'128');
  assert.deepEqual(await select.locator('option').allTextContents(),['64KiB','128KiB','256KiB','512KiB']);
  await page.getByRole('checkbox',{name:'LUN 1 선택',exact:true}).check();
  await page.getByRole('checkbox',{name:'LUN 2 선택',exact:true}).check();
  await page.getByRole('button',{name:'Stripe당 데이터 블록 크기 설명',exact:true}).hover();
  await page.getByRole('tooltip').getByText('일반적인 VM',{exact:true}).waitFor();
  await page.waitForFunction(()=>{
    let node=document.querySelector('[role="tooltip"]');
    if(!node)return false;
    while(node){if(Number(getComputedStyle(node).opacity)<0.99)return false;node=node.parentElement;}
    return true;
  });
  await page.screenshot({path:path.join(output,'react-stripe-tooltip.png')});
  await page.mouse.move(20,20);
  for(const size of [64,128,256,512]){
    await select.selectOption(String(size));
    await page.waitForFunction(size=>localStorage.getItem('fixture-stripe-size')===String(size),size);
    await page.locator('#gfs-stripe-size-kib:enabled').waitFor();
  }
  await page.evaluate(()=>window.__failSave=true);
  await select.selectOption('256');
  await page.getByRole('alert').filter({hasText:'설정 저장 테스트 실패'}).waitFor();
  assert.equal(await select.inputValue(),'512');
  assert.equal(await page.getByRole('button',{name:'다음',exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.__failSave=false);
  await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
  await page.locator('#gfs-stripe-size-kib:enabled').waitFor();
  assert.equal(await select.inputValue(),'512');
  await page.reload();
  await openDiskStep();
  assert.equal(await select.inputValue(),'512');
  await select.selectOption('256');
  await page.locator('#gfs-stripe-size-kib:enabled').waitFor();
  await page.getByRole('checkbox',{name:'LUN 1 선택',exact:true}).check();
  await page.getByRole('checkbox',{name:'LUN 2 선택',exact:true}).check();
  await page.getByRole('button',{name:'다음',exact:true}).click();
  const addresses=page.locator('input[id^="gfs-ipmi-common-ip-"]');
  assert.equal(await addresses.count(),3);
  for(let i=0;i<3;i++)await addresses.nth(i).fill('192.0.2.'+(101+i));
  await page.locator('#gfs-ipmi-common-user').fill('fixture-admin');
  await page.locator('#gfs-ipmi-common-pass').fill('fixture-password');
  await page.getByRole('button',{name:'다음',exact:true}).click();
  if(!await page.getByText('256KiB',{exact:true}).isVisible()) {
    await page.locator('.ct-gfs-storage-wizard__review-header').filter({hasText:'GFS 디스크 구성'}).click();
  }
  await page.getByText('256KiB',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'react-stripe-review.png')});
  await page.getByRole('button',{name:'구성',exact:true}).click();
  await page.getByRole('dialog',{name:'GFS 스토리지 구성 진행',exact:true}).getByRole('button',{name:'실행',exact:true}).click();
  await page.locator('.pf-v6-c-alert__title').filter({hasText:'PCS 클러스터와 IPMI STONITH 및 GFS 디스크 구성이 완료되었습니다.'}).waitFor();
  const create=await page.evaluate(()=>window.__requests.find(r=>r.body.action==='create-gfs'));
  assert.equal(create.body.stripe_size_kib,256);
  assert.equal(create.body.disks.length,2);
  assert.deepEqual(errors,[]);
  console.log('React: defaults, tooltip, four choices, persistence, failed-save guard and simulated deployment passed.');

  for(const [label,root] of [['diplo',repo+'-diplo'],['europa',repo+'-europa'],['react-legacy',repo]]){
    const css=await readFile(path.join(root,'src/common/ablestack.css'),'utf8');
    const html=await readFile(path.join(root,'src/features/gfs-storage-configure-wizard.html'),'utf8');
    const source=await readFile(path.join(root,'src/features/gfs-storage-configure-wizard.js'),'utf8');
    const start=html.indexOf('<div class="pf-v6-c-wizard__main-body" id="div-modal-wizard-gfs-disk-configure">');
    const end=html.indexOf('<div class="pf-v6-c-wizard__main-body" id="div-modal-wizard-gfs-ipmi">',start);
    const helper=source.slice(source.indexOf('var gfsStripeSettingsReady'),source.indexOf('// Document.ready 시작'));
    const dom=`window.pluginpath='/fixture';window.saved=128;window.failSave=false;
      window.cockpit=window.ablestack={async spawn(args){if(window.failSave)return JSON.stringify({code:500,val:'설정 저장 테스트 실패'});if(args.includes('--set-gfs-settings'))window.saved=Number(args.at(-1));return JSON.stringify({code:200,val:{stripe_size_kib:window.saved}});}};
      window.$=function(selector){const nodes=typeof selector==='string'?Array.from(document.querySelectorAll(selector)):[selector];return {length:nodes.length,
        prop(k,v){nodes.forEach(n=>n[k]=v);return this;},val(v){if(v===undefined)return nodes[0].value;nodes.forEach(n=>n.value=v);return this;},
        text(v){nodes.forEach(n=>n.textContent=v);return this;},hide(){nodes.forEach(n=>n.style.display='none');return this;},show(){nodes.forEach(n=>n.style.display='block');return this;},
        on(event,selector,handler){if(typeof selector==='function')nodes.forEach(n=>n.addEventListener(event,selector));else nodes.forEach(n=>n.addEventListener(event,e=>{if(e.target.matches(selector))handler.call(e.target,e);}));return this;}};};
      ${helper};loadGfsStripeSettings();`;
    const filename=path.join(output,label+'.html');
    await writeFile(filename,`<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><style>${css}.fixture{max-width:1050px;margin:30px auto;padding:24px;border:1px solid #ccc}.fa-question-circle:before{content:'?';font-weight:bold}</style><body><div class="fixture"><h1>GFS 디스크 구성</h1>${html.slice(start,end)}</div><script>${dom}</script></body></html>`);
    await page.goto(pathToFileURL(filename).href);
    const legacy=page.getByRole('combobox',{name:'Stripe당 데이터 블록 크기',exact:true});
    await page.locator('#gfs-stripe-size-kib:enabled').waitFor();
    assert.equal(await legacy.inputValue(),'128');
    await page.getByRole('button',{name:'Stripe당 데이터 블록 크기 설명',exact:true}).hover();
    await page.getByRole('tooltip').getByText('순차 I/O 중심',{exact:true}).waitFor();
    const box=await page.getByRole('tooltip').boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=1440,'legacy tooltip stays inside the viewport');
    await page.screenshot({path:path.join(output,label+'-stripe-tooltip.png')});
    await page.mouse.move(20,20);
    await legacy.selectOption('512');
    await page.waitForFunction(()=>window.gfsStripeSettingsReady&&window.saved===512);
    await page.evaluate(()=>window.failSave=true);
    await legacy.selectOption('256');
    await page.getByRole('alert').filter({hasText:'설정 저장 테스트 실패'}).waitFor();
    assert.equal(await legacy.inputValue(),'512');
    assert.equal(await page.evaluate(()=>window.gfsStripeSettingsReady),false);
    await page.evaluate(()=>window.failSave=false);
    await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
    await page.waitForFunction(()=>window.gfsStripeSettingsReady);
    console.log(label+': tooltip, save, failure rollback and retry passed.');
  }
  console.log('Screenshots: '+output);
}catch(error){
  if(page){await page.screenshot({path:path.join(output,'failed.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3000));}
  console.error('Screenshots: '+output);throw error;
}finally{await browser.close();}
