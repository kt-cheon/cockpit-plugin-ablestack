/**
 * File Name : storage-vm-status-update.js
 * Date Created : 2020.03.17
 * Writer : 최진성
 * Description : 스토리지센터 가상머신 상태 변경시 발생하는 이벤트 처리를 위한 JavaScript
**/
var centerBootstrapRunning = false;
var centerBootstrapCompleted = false;

function runCenterBootstrap(kind) {
  if (centerBootstrapRunning) return Promise.resolve(false);
  centerBootstrapRunning = true;
  centerBootstrapCompleted = false;
  const title = kind === 'scvm' ? '스토리지센터' : '클라우드센터';
  const prefix = '[ABLESTACK-PROGRESS] ';
  const lines = [];
  let pending = '';
  const log = $('#center-bootstrap-log');
  log.text('');
  $('#center-bootstrap-title').text(title + ' 구성 진행');
  $('#center-bootstrap-status').text('구성 작업을 진행하고 있습니다.');
  $('#center-bootstrap-log-path').text('상세 실행 로그: /var/log/' + kind + '_bootstrap.log');
  $('#button-close-center-bootstrap').prop('disabled', true);
  $('#center-bootstrap-spinner').show();
  $('#div-modal-center-bootstrap').show();

  function append(message) {
    lines.push(message);
    if (lines.length > 600) lines.shift();
    log.text(lines.join('\n'));
    log.scrollTop(log[0].scrollHeight);
  }
  function consume(chunk) {
    pending += chunk;
    const received = pending.split('\n');
    pending = received.pop();
    received.forEach(function (line) {
      if (line.startsWith(prefix)) append(line.slice(prefix.length).replace(/\r$/, ''));
    });
    if (pending.length > 65536) pending = '';
  }
  function finish(succeeded) {
    consume('\n');
    centerBootstrapRunning = false;
    centerBootstrapCompleted = succeeded;
    $('#center-bootstrap-spinner').hide();
    $('#button-close-center-bootstrap').prop('disabled', false);
    $('#center-bootstrap-status').text(succeeded
      ? title + ' 구성이 완료되었습니다. 닫기를 누르면 상태를 갱신합니다.'
      : title + ' 구성이 중단되었습니다. 아래 로그에서 실패한 단계와 대상을 확인하십시오.');
    if (!succeeded) append('구성 작업에 실패했습니다. 마지막 진행 로그와 상세 실행 로그를 확인하십시오.');
    return succeeded;
  }

  append(title + ' 구성 요청을 시작합니다.');
  const command = ['sh', pluginpath + '/shell/host/bootstrap_run.sh', kind];
  if (kind === 'ccvm') command.push(sessionStorage.getItem('license_type') || 'ablestack');
  try {
    const process = ablestack.spawn(command, {err: 'out'});
    process.stream(consume);
    return new Promise(function (resolve) {
      process.then(function () { resolve(finish(true)); }, function () { resolve(finish(false)); });
    });
  } catch (error) {
    append('구성 작업을 시작하지 못했습니다: ' + error.message);
    return Promise.resolve(finish(false));
  }
}

$('#button-close-center-bootstrap').on('click', function () {
  if (centerBootstrapRunning) return;
  $('#div-modal-center-bootstrap').hide();
  if (centerBootstrapCompleted) location.reload();
});

// 닫기 이벤트 처리
$('#button-close1, #button-close2').on('click', function(){
  $('#div-modal-storage-vm-status-update').hide();
});

// 실행 버튼 클릭 이벤트
$('#button-storage-vm-status-update').on('click', function(){
  var cmd = $('#scvm-status-update-cmd').val();
  if (cmd === 'bootstrap' || cmd === 'bootstrap_ccvm') {
    $('#div-modal-storage-vm-status-update').hide();
    $('#scvm-status-update-cmd').val('');
    runCenterBootstrap(cmd === 'bootstrap' ? 'scvm' : 'ccvm');
    return;
  }
  $('#dropdown-menu-storage-vm-status').toggle();
  $('#div-modal-storage-vm-status-update').hide();
  $('#div-modal-spinner-header-txt').text('스토리지센터 가상머신 상태 변경중입니다.');
  $('#div-modal-spinner').show();
  createLoggerInfo("button-storage-vm-status-update click");

  if(cmd == "stop"){//스토리지센터VM 정지 버튼 클릭시
    ablestack.spawn(["python3", pluginpath+"/python/scvm_status/scvm_status_update.py", "stop" ])
    .then(function(data){
      //console.log(data);
      var retVal = JSON.parse(data);
      if(retVal.code == "200"){
        console.log(data);
        location.reload();
      }else{
        createLoggerInfo(":::scvm stop Error:::");
        console.log(":::scvm stop Error::: "+ data);
      }
    })
    .catch(function(data){
      createLoggerInfo(":::scvm stop Error:::");
      console.log(":::scvm stop Error::: " + data);
    });
  }else if(cmd == "start"){//스토리지센터VM 시작 버튼 클릭시
    ablestack.spawn(["python3", pluginpath+"/python/scvm_status/scvm_status_update.py", "start" ])
    .then(function(data){
      //console.log(data);
      var retVal = JSON.parse(data);
      if(retVal.code == "200"){
        console.log(data);
        location.reload();
      }else{
        createLoggerInfo(":::scvm start Error:::");
        console.log(":::scvm start Error::: "+ data);
      }
    })
    .catch(function(data){
      createLoggerInfo(":::scvm delete Error:::");
      console.log(":::scvm delete Error::: "+data);
    });
  }else if(cmd == "delete"){//스토리지센터VM 삭제 버튼 클릭시
    ablestack.spawn(["python3", pluginpath+"/python/scvm_status/scvm_status_update.py", "delete" ])
    .then(function(data){
      //console.log(data);
      var retVal = JSON.parse(data);
      if(retVal.code == "200"){
        //scvm bootstrap 프로퍼티 초기화
        ablestack.spawn(["python3", pluginpath+"/python/ablestack_json/ablestackJson.py", "update", "--depth1", "bootstrap", "--depth2", "scvm", "--value", "false"])
        .then(function(data){
          createLoggerInfo("Success in initializing ablestackJson's scvm setting to false");
          console.log("Success in initializing ablestackJson's scvm setting to false");
        })
        .catch(function(err){
          createLoggerInfo("Error in initializing ablestackJson's scvm setting to false");
          console.log("Error in initializing ablestackJson's scvm setting to false : " + err);
        });
        console.log(data);
        location.reload();
      }else{
        createLoggerInfo(":::scvm delete Error:::");
        console.log(":::scvm delete Error::: "+ data);
      }
    })
    .catch(function(data){
      createLoggerInfo(":::scvm delete Error:::");
      console.log(":::scvm delete Error:::"+data);
    });
  }
  $('#scvm-status-update-cmd').val("");
});
