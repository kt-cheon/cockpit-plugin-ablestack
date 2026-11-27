// Simulated APIs only: this test never runs ceph-volume or touches block devices.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {sassPlugin} from 'esbuild-sass-plugin';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

const frontend=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(path.join(os.tmpdir(),'disk-initialize-ui-'));
await build({absWorkingDir:frontend,stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import '@patternfly/patternfly/patternfly.css';import './src/status/status.scss';
import Wizard from './src/wizard/storage-vm-deploy-wizard.tsx';
createRoot(document.getElementById('app')).render(<Wizard isOpen onClose={()=>{}} />);
`,resolveDir:frontend,loader:'tsx'},bundle:true,outfile:path.join(output,'app.js'),platform:'browser',
loader:{'.woff2':'file','.woff':'file','.ttf':'file','.svg':'file'},
plugins:[sassPlugin({silenceDeprecations:['legacy-js-api','import','global-builtin','color-functions']}),
{name:'fixture',setup(builder){builder.onLoad({filter:/platform\/cockpit\.ts$/},()=>({contents:'export default window.__cockpit;',loader:'ts'}));}}]});
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="ko" class="pf-v6-theme-dark"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="app"></div><script>
window.__requests=[];window.__mode='success';window.__raw=[
{name:'sda',kname:'sda',path:'/dev/sda',size:'223.6G',type:'disk',children:[{name:'sda1',type:'part',mountpoints:['/']}]},
...['sdb','sdc'].map(name=>({name,kname:name,path:'/dev/'+name,size:'894.3G',type:'disk',model:'Fixture SATA',children:[{name:name+'1',type:'part'}]})),
{name:'sdd',kname:'sdd',path:'/dev/sdd',size:'2.2T',type:'disk'}];
window.__cockpit={spawn(argv){if(argv[0]==='hostname')return Promise.resolve('ablecube1');let resolve;
const operation=new Promise(done=>resolve=done);operation.input=payload=>{const request=JSON.parse(payload);window.__requests.push(request);
let response={code:200,val:{}};
if(request.path==='/api/v1/cube/disk?action=list')response={code:200,val:{raidcontrollers:[{Slot:'0000:5f:00.0',Class:'RAID bus controller',Vendor:'Fixture'}],blockdevices:window.__raw}};
if(request.path==='/api/v1/cube/nics?action=detail')response={code:200,val:{bridges:[{DEVICE:'bridge0',TYPE:'bridge',STATE:'connected'},{DEVICE:'virbr0',TYPE:'bridge',STATE:'connected'}]}};
if(request.path==='/api/v1/cube/cluster/config')response={clusterConfig:{type:'ablestack-hci',hosts:[]}};
if(request.path==='/api/v1/cube/system/config')response={code:200,val:{ui:{}}};
if(request.path==='/api/v1/cube/_tasks')response={code:200,jobs:[]};
if(request.path==='/api/v1/cube/disk/initialize'){
if(request.method==='GET')response={code:200,hostname:'ablecube1',disks:window.__raw.map(d=>({path:d.path,identity:d.name,
 label:d.path+' · '+d.size,can_initialize:d.name!=='sda',reason:d.name==='sda'?'운영체제 디스크 사용 중':'',state:d.children?.length?'파티션이 있습니다.':'파티션 없음'}))};
else {window.__releaseInitialize=()=>{const results=request.body.devices.map((item,i)=>{
const failed=window.__mode==='partial'&&i===1;
if(!failed)window.__raw.find(d=>d.path===item.path).children=[];
return {path:item.path,status:failed?'failed':'completed',message:failed?'장치 사용 중':'초기화 완료'};});
resolve(JSON.stringify({code:200,success:results.every(r=>r.status==='completed'),results}));};return;}}
resolve(JSON.stringify(response));};return operation;}};
</script><script src="app.js"></script></body></html>`);

const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const settle=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
const dialog=page.getByRole('dialog',{name:'스토리지센터 가상머신 배포 마법사',exact:true});
const next=dialog.getByRole('button',{name:'다음',exact:true});
const start=async()=>{
await page.goto('about:blank');await page.goto(pathToFileURL(path.join(output,'index.html')).href);
await dialog.waitFor();await next.click();await next.click();
await dialog.getByRole('checkbox',{name:'/dev/sdb · 894.3G',exact:true}).waitFor();
};
const openConfirmation=async()=>{
await dialog.getByRole('checkbox',{name:'/dev/sdb · 894.3G',exact:true}).check();
await dialog.getByRole('checkbox',{name:'/dev/sdc · 894.3G',exact:true}).check();
await dialog.getByRole('button',{name:'선택한 디스크 초기화',exact:true}).click();
return page.getByRole('dialog',{name:'디스크 초기화 확인',exact:true});
};
try {
await start();
assert.equal(await dialog.getByRole('checkbox',{name:'/dev/sda · 223.6G',exact:true}).isDisabled(),true);
const unavailable=dialog.locator('.ct-storage-vm-wizard__disk-unavailable');
await unavailable.filter({hasText:'/dev/sda'}).focus();
const tooltip=page.getByRole('tooltip');
await tooltip.getByText('사용 불가 · 운영체제 디스크 사용 중',{exact:true}).waitFor();
await page.keyboard.press('Tab');
await tooltip.waitFor({state:'hidden'});
assert.equal(await dialog.getByText('운영체제 디스크 사용 중',{exact:false}).count(),0);
await dialog.getByRole('button',{name:'건너뛰기',exact:true}).click();
await dialog.getByRole('radio',{name:'Disk Passthrough',exact:true}).check();
assert.equal(await dialog.getByRole('checkbox',{name:'/dev/sdb · 894.3G · Fixture SATA',exact:true}).isDisabled(),true);
const unavailableSdb=unavailable.filter({hasText:'/dev/sdb'});
await unavailableSdb.locator('.ct-storage-vm-wizard__disk-unavailable-icon').waitFor();
await unavailableSdb.hover();
await tooltip.getByText(/사용 불가 · 파티션·LVM/).waitFor();
await page.mouse.move(0,0);
await tooltip.waitFor({state:'hidden'});
await page.screenshot({path:path.join(output,'unavailable-disks.png'),fullPage:true});
await dialog.getByRole('checkbox',{name:'/dev/sdd · 2.2T',exact:true}).check();
await dialog.getByRole('button',{name:'이전',exact:true}).click();
const confirm=await openConfirmation();
await confirm.locator('.pf-v6-c-alert__title').filter({hasText:'이 작업은 되돌릴 수 없습니다.'}).waitFor();
assert.deepEqual(await confirm.getByRole('list',{name:'초기화 디스크 목록'}).locator('li').allTextContents(),['/dev/sdb · 894.3G','/dev/sdc · 894.3G']);
await confirm.getByRole('textbox',{name:'디스크 초기화 확인 문구'}).fill('확인했습니다.');
const erase=confirm.getByRole('button',{name:'데이터 삭제 및 초기화',exact:true});
assert.equal(await erase.isDisabled(),true);
assert.equal(await page.evaluate(()=>window.__requests.filter(r=>r.path==='/api/v1/cube/disk/initialize'&&r.method==='POST').length),0);
await confirm.getByRole('textbox',{name:'디스크 초기화 확인 문구'}).fill('확인했습니다');
assert.equal(await erase.isDisabled(),false);
await settle();
await page.screenshot({path:path.join(output,'multi-disk-confirmation.png'),fullPage:true});
await erase.click();
await page.waitForFunction(()=>typeof window.__releaseInitialize==='function');
assert.equal(await confirm.getByRole('button',{name:'취소',exact:true}).isDisabled(),true);
await page.evaluate(()=>window.__releaseInitialize());
await confirm.waitFor({state:'hidden'});
await dialog.getByRole('radio',{name:'Disk Passthrough',exact:true}).check();
for(const name of ['sdb','sdc']){
const checkbox=dialog.getByRole('checkbox',{name:'/dev/'+name+' · 894.3G · Fixture SATA',exact:true});
await checkbox.waitFor();assert.equal(await checkbox.isDisabled(),false);
}
assert.equal(await dialog.locator('.ct-storage-vm-wizard__disk-list input:checked').count(),0);
assert.equal(await next.isDisabled(),false);
const sent=await page.evaluate(()=>window.__requests.find(r=>r.path==='/api/v1/cube/disk/initialize'&&r.method==='POST').body);
assert.deepEqual(sent,{confirmation:'확인했습니다',devices:[{path:'/dev/sdb',identity:'sdb'},{path:'/dev/sdc',identity:'sdc'}]});
await settle();
await page.screenshot({path:path.join(output,'initialized-disks-available.png'),fullPage:true});

await start();await page.evaluate(()=>window.__mode='partial');
const partial=await openConfirmation();
await partial.getByRole('textbox',{name:'디스크 초기화 확인 문구'}).fill('확인했습니다');
await partial.getByRole('button',{name:'데이터 삭제 및 초기화',exact:true}).click();
await page.waitForFunction(()=>typeof window.__releaseInitialize==='function');
await page.evaluate(()=>window.__releaseInitialize());
await partial.waitFor({state:'hidden'});
await dialog.locator('.pf-v6-c-alert__title').filter({hasText:'일부 디스크를 초기화하지 못했습니다. 디스크별 결과를 확인하세요.'}).waitFor();
await dialog.getByLabel('디스크별 초기화 결과').getByText('/dev/sdc · 실패 · 장치 사용 중',{exact:true}).waitFor();
assert.equal(await dialog.getByRole('radio',{name:'Disk Passthrough',exact:true}).count(),0);
await settle();
await page.screenshot({path:path.join(output,'partial-initialization.png'),fullPage:true});
await dialog.getByRole('button',{name:'건너뛰기',exact:true}).click();
await dialog.getByRole('radio',{name:'Disk Passthrough',exact:true}).check();
assert.equal(await dialog.getByRole('checkbox',{name:'/dev/sdc · 894.3G · Fixture SATA',exact:true}).isDisabled(),true);
assert.equal(await dialog.getByRole('checkbox',{name:'/dev/sdb · 894.3G · Fixture SATA',exact:true}).isDisabled(),false);
await dialog.getByRole('checkbox',{name:'/dev/sdb · 894.3G · Fixture SATA',exact:true}).check();
await next.click();
assert.equal(await dialog.locator('#storage-vm-mgmt-bridge').inputValue(),'bridge0');
assert.deepEqual(errors,[]);
console.log('Disabled reasons, multi-disk typed confirmation, refresh after erase, skip and partial results passed.');
console.log('Screenshots: '+output);
}catch(error){await page.screenshot({path:path.join(output,'failed.png'),fullPage:true}).catch(()=>{});
console.error((await page.locator('body').innerText()).slice(-2600));console.error('Screenshots: '+output);throw error;
}finally{await browser.close();}
