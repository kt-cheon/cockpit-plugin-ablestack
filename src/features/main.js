/**
 * File Name : main.js
 * Date Created : 2020.02.18
 * Writer  : 박동혁
 * Description : main.html에서 발생하는 이벤트 처리를 위한 JavaScript
 **/

// document.ready 영역 시작

this.ccvm_instance = new CloudCenterVirtualMachine();
ccvm_instance = this.ccvm_instance;
$(document).ccvm_instance = ccvm_instance;
pluginpath = '/usr/share/cockpit/ablestack';
let pcs_exe_host = "";
var os_type = sessionStorage.getItem("os_type");
//PFMP 설치 시 퍼센트 값 설정 초가화
let interval;

$(document).ready(function(){

    $('#dropdown-menu-storage-cluster-status').hide();
    $('#dropdown-menu-cloud-cluster-status').hide();
    $('#dropdown-menu-storage-vm-status').hide();
    $('#dropdown-menu-cloud-vm-status').hide();

    $('#button-open-modal-wizard-storage-cluster').hide();
    $('#button-open-modal-wizard-storage-vm').hide();
    $('#button-open-modal-wizard-pfmp-vm').hide();
    $('#button-open-modal-wizard-cloud-vm').hide();
    $('#button-link-storage-center-dashboard').hide();
    $('#button-link-cloud-center').hide();
    $('#button-open-modal-wizard-monitoring-center').hide();
    $('#button-link-monitoring-center').hide();
    $('#button-config-file-download').hide();

    $('#div-modal-wizard-storage-vm').load("./src/features/storage-vm-wizard.html");
    $('#div-modal-wizard-storage-vm').hide();

    $('#div-modal-wizard-pfmp-vm').load("./src/features/pfmp-vm-wizard.html");
    $('#div-modal-wizard-pfmp-vm').hide();

    $('#div-modal-wizard-cluster-config-prepare').load("./src/features/cluster-config-prepare.html");
    $('#div-modal-wizard-cluster-config-prepare').hide();

    $('#div-modal-wizard-cloud-vm').load("./src/features/cloud-vm-wizard.html");
    $('#div-modal-wizard-cloud-vm').hide();

    $('#div-modal-wizard-wall-monitoring').load("./src/features/wall-monitoring-wizard.html");
    $('#div-modal-wizard-wall-monitoring').hide();

    $('#dev-modal-migration-cloud-vm').hide();
    $('#dev-modal-stop-cloud-vm').hide();

    $('#div-change-modal-cloud-vm').load("./src/features/cloud-vm-change.html");
    $('#div-change-modal-cloud-vm').hide();
    $('#div-change-alert-cloud-vm').load("./src/features/cloud-vm-change-alert.html");
    $('#div-change-alert-cloud-vm').hide();

    $('#div-cloud-vm-snap').load("./src/features/cloud-vm-snap.html");
    $('#div-cloud-vm-snap').hide();

    // 스토리지 센터 가상머신 자원변경 페이지 로드
    $('#div-modal-storage-vm-resource-update').load("./src/features/storage-vm-resource-update.html");
    $('#div-modal-storage-vm-resource-update').hide();
    // 스토리지 센터 가상머신 상태변경 페이지 로드
    $('#div-modal-storage-vm-status-update').load("./src/features/storage-vm-status-update.html");
    $('#div-modal-storage-vm-status-update').hide();
    // 스토리지 클러스터 유지보수 모드 변경 페이지 로드
    $('#div-modal-storage-cluster-maintenance-update').load("./src/features/storage-cluster-maintenance-update.html");
    $('#div-modal-storage-cluster-maintenance-update').hide();
    // 전체 시스템 종료 페이지 로드
    $('#div-modal-auto-shutdown').load("./src/features/auto-shutdown.html");
    $('#div-modal-auto-shutdown').hide();
    // ccvm db 백업 페이지 로드
    $('#div-modal-db-backup-cloud-vm-first').load("./src/features/cloud-vm-dbbackup.html");
    $('#div-modal-db-backup-cloud-vm-first').hide();

    // 일반 가상화일 경우 화면 변환
    screenConversion();

    cockpit.spawn(['python3', pluginpath + '/python/pcs/pcsExehost.py'])
    .then(function (data) {
        let retVal = JSON.parse(data);
        pcs_exe_host = retVal.val;
        ribbonWorker();
        //30초마다 화면 정보 갱신
        setInterval(() => {
            createLoggerInfo("Start collecting ablestack status information : setInterval()");
            // 배포상태 조회(비동기)완료 후 배포상태에 따른 요약리본 UI 설정
            ribbonWorker();
        }, 30000);
    })
    .catch(function (err) {
        ribbonWorker();
        //30초마다 화면 정보 갱신
        setInterval(() => {
            createLoggerInfo("Start collecting ablestack status information : setInterval()");
            // 배포상태 조회(비동기)완료 후 배포상태에 따른 요약리본 UI 설정
            ribbonWorker();
        }, 30000);
        createLoggerInfo("pcsExeHost err");
        console.log("pcsExeHost err : " + err);
    });
});
// document.ready 영역 끝

// 이벤트 처리 함수
$('#card-action-cloud-cluster-status').on('click', function(){
    $('#dropdown-menu-cloud-cluster-status').toggle();
});

$('#card-action-storage-vm-status').on('click', function(){
    $('#dropdown-menu-storage-vm-status').toggle();
});

$('#card-action-cloud-vm-status').on('click', function(){
    $('#dropdown-menu-cloud-vm-status').toggle();
});

var cpu=0;
var memory=0;
$('#card-action-cloud-vm-change').on('click', function(){
    ccvm_instance.createChangeModal();
});

$('#card-action-cloud-vm-connect').on('click', function(){
    // 클라우드센터VM 연결
    window.open('http://' + ccvm_instance.ip + ":9090");
});

$('#button-open-modal-wizard-storage-vm').on('click', function(){
    $('#div-modal-wizard-storage-vm').show();
});

$('#button-open-modal-wizard-pfmp-vm').on('click', function(){
 $('#div-modal-wizard-pfmp-vm').show();
});

$('#button-open-modal-wizard-storage-cluster').on('click', function(){
    readSshKeyFile();
    $('#div-modal-wizard-cluster-config-prepare').show();
});

$('#button-open-modal-wizard-cloud-vm').on('click', function(){
    $('#div-modal-wizard-cloud-vm').show();
});

$('#button-open-modal-wizard-monitoring-center').on('click', function(){
    $('#div-modal-wizard-wall-monitoring').show();
    autoConfigWallIP();
});

$('#button-link-storage-center-dashboard').on('click', function(){
    // storageCenter url 링크 주소 가져오기
    createLoggerInfo("button-link-storage-center-dashboard click");
    cockpit.spawn(["python3", pluginpath+"/python/url/create_address.py", "storageCenter"])
    .then(function(data){
        var retVal = JSON.parse(data);
        if(retVal.code == 200){
            // 스토리지센터 연결
            window.open(retVal.val);
        }else{
            $("#modal-status-alert-title").html("스토리지센터 연결");
            $("#modal-status-alert-body").html(retVal.val);
            $('#div-modal-status-alert').show();
        }
    })
    .catch(function(err){
        createLoggerInfo(":::create_address.py storageCenter Error:::");
        console.log(":::create_address.py storageCenter Error:::"+ err);
    });
});

$('#button-link-cloud-center').on('click', function(){
    // 클라우드센터 연결
    createLoggerInfo("button-link-cloud-center click");
    cockpit.spawn(["python3", pluginpath+"/python/url/create_address.py", "cloudCenter"])
        .then(function(data){
            var retVal = JSON.parse(data);
            if(retVal.code == 200){
                window.open(retVal.val);
            }else{
                $("#modal-status-alert-title").html("클라우드센터 연결");
                $("#modal-status-alert-body").html(retVal.val);
                $('#div-modal-status-alert').show();
            }
        })
        .catch(function(err){
            createLoggerInfo(":::create_address.py cloudCenter Error:::");
            console.log(":::create_address.py cloudCenter Error:::"+ err);
        });
});

$('#button-link-monitoring-center').on('click', function(){
    // 모니터링센터 대시보드 연결
    cockpit.spawn(["python3", pluginpath+"/python/url/create_address.py", "wallCenter"])
        .then(function(data){
            var retVal = JSON.parse(data);
            if(retVal.code == 200){
                window.open(retVal.val);
            }else{
                $("#modal-status-alert-title").html("모니터링센터 대시보드 연결");
                $("#modal-status-alert-body").html(retVal.val);
                $('#div-modal-status-alert').show();
            }
        })
        .catch(function(err){
            console.log(":::create_address.py wallCenter Error:::"+ err);
        });
});

// 스토리지센터 클러스터 유지보수모드 설정 버튼 클릭시 modal의 설명 세팅
$('#menu-item-set-maintenance-mode').on('click',function(){
    $('#modal-description-maintenance-status').html("<p>스토리지 클러스터를 유지보수 모드를 '설정' 하시겠습니까?</p>");
    $('#scc-maintenance-update-cmd').val("set");
    $('#div-modal-storage-cluster-maintenance-update').show();
});

// 스토리지센터 클러스터 유지보수모드 해제 버튼 클릭시 modal의 설명 세팅
$('#menu-item-unset-maintenance-mode').on('click',function(){
    $('#modal-description-maintenance-status').html("<p>스토리지 클러스터를 유지보수 모드를 '해제' 하시겠습니까?</p>");
    $('#scc-maintenance-update-cmd').val("unset");
    $('#div-modal-storage-cluster-maintenance-update').show();
});

// 스토리지센터 VM 시작 버튼 클릭시 modal의 설명 세팅
$('#menu-item-set-storage-center-vm-start').on('click',function(){
    $('#modal-title-scvm-status').text("스토리지 센터 가상머신 상태 변경");
    $('#modal-description-scvm-status').html("<p>스토리지 센터 가상머신을 '시작' 하시겠습니까?</p>");
    $('#button-storage-vm-status-update').html("시작");
    $('#scvm-status-update-cmd').val("start");
    $('#div-modal-storage-vm-status-update').show();
});

// 스토리지센터 VM 정지 버튼 클릭시 modal의 설명 세팅
$('#menu-item-set-storage-center-vm-stop').on('click',function(){
    $('#modal-title-scvm-status').text("스토리지 센터 가상머신 상태 변경");
    $('#modal-description-scvm-status').html("<p>스토리지 센터 가상머신을 '정지' 하시겠습니까?</p>");
    $('#button-storage-vm-status-update').html("정지");
    $('#scvm-status-update-cmd').val("stop");
    $('#div-modal-storage-vm-status-update').show();
});

// 스토리지센터 VM 삭제 버튼 클릭시 modal의 설명 세팅
$('#menu-item-set-storage-center-vm-delete').on('click',function(){
    $('#modal-title-scvm-status').text("스토리지 센터 가상머신 상태 변경");
    $('#modal-description-scvm-status').html("<p>스토리지 센터 가상머신을 '삭제' 하시겠습니까?</p>");
    $('#button-storage-vm-status-update').html("삭제");
    $('#scvm-status-update-cmd').val("delete");
    $('#div-modal-storage-vm-status-update').show();
});

// 스토리지센터 VM 자원변경 버튼 클릭시 modal의 설명 세팅
$('#menu-item-set-storage-center-vm-resource-update').on('click', function(){
    //현재 cpu, memory 값은 선택이 되지 않도록 disabled
    $("#form-select-storage-vm-cpu-update option[value="+ sessionStorage.getItem("scvm_cpu") +"]").prop('disabled',true);
    $("#form-select-storage-vm-memory-update option[value="+ sessionStorage.getItem("scvm_momory").split(' ')[0] +"]").prop('disabled',true);
    $('#div-modal-storage-vm-resource-update').show();
});

// 전체 시스템 종료 버튼 클릭시 modal의 설명 세팅
$('#menu-item-set-auto-shutdown-step-two').on('click',function(){
    $('#modal-description-auto-shutdown').html("전체 시스템을 '종료' 하시겠습니까?<br><br> 사전에 각 호스트에 Mount된 볼륨을 작업 수행자가 직접 해제해야 합니다. 해제 후, 아래 볼륨 마운트 해제 확인 스위치를 클릭하여 계속 진행합니다.");
    $('#auto-shutdown-cmd').val("start");
    $('#div-modal-auto-shutdown').show();
    $('#button-auto-shutdown').show();
    $('#button-close-auto-shutdown').show();
    $('#modal-div-auto-shutdown-mount').show();
});

// 클라우드센터 VM DB 백업 드롭다운 버튼 클릭시
$('#card-action-cloud-vm-db-dump').on('click', function(){
    $('#div-modal-db-backup-cloud-vm-first').show();
    $('#div-modal-wizard-cluster-config-finish-db-dump-file-download-empty-state').hide();
});

//div-modal-status-alert modal 닫기
$('#modal-status-alert-button-close1, #modal-status-alert-button-close2').on('click', function(){
    $('#div-modal-status-alert').hide();
    location.reload();
});

// 상태 보기 드롭다운 메뉴를 활성화한 상태에서 다른 영역을 클릭 했을 경우 메뉴 닫기 (현재 활성화된 iframe 클릭할 때 작동)
$('html').on('click', function(e){
    if(!$(e.target).hasClass('pf-c-dropdown__toggle')){
        $('.pf-c-dropdown__menu, .pf-m-align-right').hide();
    }
});

// 상태 보기 드롭다운 메뉴를 활성화한 상태에서 다른 영역을 클릭 했을 경우 메뉴 닫기 (pareant html 클릭할 때 작동)
$(top.document, 'html').on('click', function(e){
    if(!$(e.target).hasClass('pf-c-dropdown__toggle')){
        $('.pf-c-dropdown__menu, .pf-m-align-right').hide();
    }
});

// 상태 보기 드롭다운 메뉴를 활성화한 상태에서 다른 드롭다운 메뉴를 클릭 했을 경우 메뉴 닫기
$('.pf-c-dropdown').on('click', function(e){
    $('.pf-c-dropdown__menu, .pf-m-align-right').hide();
    var card_id_sting = $(this).find('ul').attr('id');
    $('#'+ card_id_sting).show();
})

// 클라우드센터 VM DB 백업 드롭다운 메뉴 클릭 시
$('#card-action-cloud-vm-db-dump').on('click', function(){

});
// 클라우드센터 VM DB 백업 실행 클릭 시
$('#button-execution-modal-cloud-vm-db-dump').on('click', function () {
    $('#dbdump-prepare-status').html("<svg class='pf-c-spinner pf-m-xl' role='progressbar' aria-valuetext='Loading...' viewBox='0 0 100 100'><circle class='pf-c-spinner__path' cx='50' cy='50' r='45' fill='none'></circle></svg>" +
    "<h1 data-ouia-component-type='PF4/Title' data-ouia-safe='true' data-ouia-component-id='OUIA-Generated-Title-1' class='pf-c-title pf-m-lg'>백업파일 준비 중...</h1><div class='pf-c-empty-state__body'></div>")
    let dump_sql_file_path = "/root/db_dump/ccvm_dump_cloud.sql"
    readFile(dump_sql_file_path);
    $('#div-db-backup').hide();
    $('#button-execution-modal-cloud-vm-db-dump').hide();
    $('#button-cancel-modal-cloud-vm-db-dump').hide();
    $('#button-close-modal-cloud-vm-db-dump').hide();
    $('#div-modal-wizard-cluster-config-finish-db-dump-file-download').hide();
})

// 클라우드센터 VM DB 백업파일 다운로드 링크 클릭 시
$('#span-modal-wizard-cluster-config-finish-db-dump-file-download').on('click', function () {

})

/**
 * Meathod Name : scvm_bootstrap_run
 * Date Created : 2021.04.10
 * Writer  : 최진성
 * Description : scvm /root/bootstrap.sh  파일 실행
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.04.10 최초 작성
 */
function scvm_bootstrap_run(){
    $("#modal-status-alert-title").html("스토리지센터 가상머신 상태 체크");
    $("#modal-status-alert-body").html("스토리지센터 가상머신이 구성되지 않아<br>스토리지센터를 구성할 수 없습니다.<br><br>잠시 후 다시 실행해 주세요.");
    createLoggerInfo("scvm_bootstrap_run() start");
    //scvm ping 체크
    cockpit.spawn(["python3", pluginpath+"/python/cloudinit_status/cloudinit_status.py", "ping", "--target",  "scvm"])
        .then(function(data){
            var retVal = JSON.parse(data);
            if(retVal.code == 200){
                //scvm 의 cloudinit 실행이 완료되었는지 확인하기 위한 명렁
                cockpit.spawn(["python3", pluginpath+"/python/cloudinit_status/cloudinit_status.py", "status", "--target",  "scvm"])
                    .then(function(data){
                        var retVal = JSON.parse(data);
                        console.log(retVal.val);
                        //cloudinit status: done 일때
                        if(retVal.code == 200 && retVal.val == "status: done"){
                            $('#modal-title-scvm-status').text("스토리지센터 구성하기");
                            $('#modal-description-scvm-status').html("<p>스토리지센터를 구성하시겠습니까?</p>");
                            $('#button-storage-vm-status-update').html("실행");
                            $('#scvm-status-update-cmd').val("bootstrap");
                            $('#div-modal-storage-vm-status-update').show();
                        }else{
                            $('#div-modal-status-alert').show();
                        }
                    })
                    .catch(function(data){
                        $('#div-modal-status-alert').show();
                        createLoggerInfo(":::scvm_bootstrap_run() Error :::");
                        console.log(":::scvm_bootstrap_run() Error :::" + data);
                    });
            }else{
                $('#div-modal-status-alert').show();
            }
        })
        .catch(function(data){
            $('#div-modal-status-alert').show();
            createLoggerInfo(":::scvm_bootstrap_run() Error :::");
            console.log(":::scvm_bootstrap_run() Error :::" + data);
        });
}

/**
 * Meathod Name : scc_link_go
 * Date Created : 2021.04.10
 * Writer  : 최진성
 * Description : 스토리지센터 연결 버튼 클릭시 URL 세팅
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.04.10 최초 작성
 */
 function scc_link_go(){
    // storageCenter url 링크 주소 가져오기
    createLoggerInfo("scc_link_go() start");
    cockpit.spawn(["python3", pluginpath+"/python/url/create_address.py", "storageCenter"])
    .then(function(data){
        createLoggerInfo("scc_link_go start");
        var retVal = JSON.parse(data);
        if(retVal.code == 200){
            // 스토리지센터 연결
            window.open(retVal.val);
        }else{
            $("#modal-status-alert-title").html("스토리지센터 연결");
            $("#modal-status-alert-body").html(retVal.val);
            $('#div-modal-status-alert').show();
        }
    })
    .catch(function(data){
        createLoggerInfo(":::scc_link_go() Error :::");
        console.log(":::scc_link_go() Error :::" + data);
    });
}

// 스토리지센터VM 연결 버튼 클릭시 URL 세팅
$('#menu-item-linkto-storage-center-vm').on('click', function(){
    // storageCenterVm url 링크 주소 가져오기
    createLoggerInfo("menu-item-linkto-storage-center-vm click");
    cockpit.spawn(["python3", pluginpath+"/python/url/create_address.py", "storageCenterVm"])
        .then(function(data){
            var retVal = JSON.parse(data);
            if(retVal.code == 200){
                // 스토리지 센터 VM 연결
                window.open(retVal.val);
            }
        })
        .catch(function(data){
            console.log(":::menu-item-linkto-storage-center-vm click Error ::: " + data);
        });
});

/**
 * Meathod Name : checkConfigStatus
 * Date Created : 2021.03.23
 * Writer  : 박다정
 * Description : 클러스터 구성준비 상태 조회
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.03.23 최초 작성
 */
function checkConfigStatus(){
    //createLoggerInfo("checkConfigStatus() start");
    return new Promise((resolve) => {
        cockpit.spawn(['grep', '-c', 'ablecube', '/etc/hosts'])
            .then(data=>{
                if(data >= 1){
                    cockpit.spawn(['cat', '/root/.ssh/id_rsa.pub'])
                        .then(data=>{
                            sessionStorage.setItem("ccfg_status", "true");
                            saveHostInfo();
                            resolve();
                        })
                        .catch(err=>{
                            // ssh-key 파일 없음
                            createLoggerInfo("no ssh-key file error");
                            sessionStorage.setItem("ccfg_status", "false");
                            resetBootstrap();
                            resolve();
                        })
                }
            })
            .catch(err=>{
                // hosts 파일 구성 되지않음
                createLoggerInfo("hosts file not configured error");
                sessionStorage.setItem("ccfg_status", "false");
                resetBootstrap();
                resolve();
            })
    });
}

/** all hosts update glue config modal 관련 action start */
function all_host_glue_config_update_modal(){
    $('#div-modal-update-glue-config').show();
}
function pfmp_install(){
    $('#div-modal-pfmp-install').show();
}
$('#button-close-modal-update-glue-config').on('click', function(){
    $('#div-modal-update-glue-config').hide();
});
$('#button-close-modal-pfmp-install').on('click', function(){
    $('#div-modal-pfmp-install').hide();
});
$('#button-execution-modal-pfmp-install').on('click', function(){
    $('#div-modal-pfmp-install').hide();
    $('#div-modal-spinner-pfmp-header-txt').text('PFMP 컨테이너 설치 중입니다.');
    $('#div-modal-spinner-pfmp').show();

    $("#modal-status-alert-title").html("PFMP 설치");
    $("#modal-status-alert-body").html("PFMP 설치를 실패하였습니다.<br/>PFMP 상태를 확인해주세요.");
    createLoggerInfo("pfmp_install() start");

    updatePfmpInstall(35,"second");
    cockpit.spawn(["python3", pluginpath+"/python/pfmp/pfmp_install.py", "pre_install"])
    .then(function(data){
        var retVal = JSON.parse(data);
        if(retVal.code == 200){
            $("#div-modal-spinner-pfmp-header-txt").text("PFMP 클러스터 및 앱을 설치 중입니다. ");
            createLoggerInfo("pfmp containers install success");
            updatePfmpInstall(105,"minute");
            cockpit.spawn(["python3", pluginpath+"/python/pfmp/pfmp_install.py", "install"])
            .then(function(data){
                var retVal = JSON.parse(data);
                console.log(retVal);
                if(retVal.code == 200){
                    console.log(retVal);
                    $("#div-modal-spinner-pfmp-header-txt").text("PFMP 가상머신을 삭제 중입니다.");
                    updatePfmpInstall(2,"second");
                    cockpit.spawn(["python3", pluginpath+"/python/pfmp/pfmp_install.py", "remove"])
                    .then(function(data){
                        var retVal = JSON.parse(data);
                        console.log(retVal);
                        if(retVal.code == 200){
                            console.log(retVal);
                            $('#div-modal-spinner-pfmp').hide();
                            $("#modal-status-alert-body").html("PFMP 설치를 성공했습니다.<br/> 성공 후 자동으로 PFMP 가상머신은 삭제됩니다.");
                            $('#div-modal-status-alert').show();
                        }else{
                            console.log(retVal);
                            $("#modal-status-alert-title").html("PFMP 설치");
                            $("#modal-status-alert-body").html("PFMP 삭제를 실패하셨습니다.<br/>PFMP 상태를 확인해주세요.");
                            $('#div-modal-spinner-pfmp').hide();
                            $('#div-modal-status-alert').show();
                            createLoggerInfo(":::pfmp_install() Error ::: error");
                            console.log(":::pfmp_install() Error :::" + data);
                        }
                    })
                    .catch(function(data){
                        $('#div-modal-spinner-pfmp').hide();
                        $('#div-modal-status-alert').show();
                        createLoggerInfo(":::pfmp_install() Error ::: error");
                        console.log(":::pfmp_install() Error :::" + data);
                    });
                    createLoggerInfo("pfmp cluster and application install success");
                }else{
                    $("#modal-status-alert-title").html("PFMP 설치");
                    $("#modal-status-alert-body").html("PFMP 클러스터 및 앱 설치를 실패하셨습니다.<br/>PFMP 및 pfmp_config.json 파일 상태를 확인해주세요.");
                    $('#div-modal-spinner-pfmp').hide();
                    $('#div-modal-status-alert').show();
                    createLoggerInfo(":::pfmp_install() Error ::: error");
                    console.log(":::pfmp_install() Error :::" + data);
                }
            })
            .catch(function(data){
                $('#div-modal-spinner-pfmp').hide();
                $('#div-modal-status-alert').show();
                createLoggerInfo(":::pfmp_install() Error ::: error");
                console.log(":::pfmp_install() Error :::" + data);
            });
        }else{
            $("#modal-status-alert-title").html("PFMP 설치");
            $("#modal-status-alert-body").html("PFMP 컨테이너 설치를 실패하셨습니다.<br/>PFMP 상태를 확인해주세요.");
            $('#div-modal-spinner-pfmp').hide();
            $('#div-modal-status-alert').show();
            createLoggerInfo(":::pfmp_install() Error ::: error");
            console.log(":::pfmp_install() Error :::" + data);
        }
    })
    .catch(function(data){
        $('#div-modal-spinner-pfmp').hide();
        $('#div-modal-status-alert').show();
        createLoggerInfo(":::pfmp_install() Error ::: error");
        console.log(":::pfmp_install() Error :::" + data);
    });
});

$('#button-execution-modal-update-glue-config').on('click', function(){
    var console_log = true;
    $('#div-modal-update-glue-config').hide();
    $('#div-modal-spinner-header-txt').text('전체 호스트 Glue 설정 업데이트하고 있습니다.');
    $('#div-modal-spinner').show();

    $("#modal-status-alert-title").html("전체 호스트 Glue 설정 업데이트");
    $("#modal-status-alert-body").html("전체 호스트 Glue 설정 업데이트를 실패하였습니다.<br/>CUBE 호스트, SCVM 상태를 확인해주세요.");
    createLoggerInfo("all_host_glue_config_update_modal() start");

    cockpit.spawn(["python3", pluginpath+"/python/glue/update_glue_config.py", "update"])
    .then(function(data){
        var retVal = JSON.parse(data);
        if(retVal.code == 200){
            $('#div-modal-spinner').hide();
            $("#modal-status-alert-body").html("전체 호스트 Glue 설정 업데이트를 성공하였습니다");
            $('#div-modal-status-alert').show();
            createLoggerInfo("all cube hosts, scvms update keyring and ceph.confg spawn success");
        }else{
            $('#div-modal-spinner').hide();
            $('#div-modal-status-alert').show();
            createLoggerInfo(":::all_host_glue_config_update_modal() Error ::: error");
            console.log(":::all_host_glue_config_update_modal() Error :::" + data);
        }
    })
    .catch(function(data){
        $('#div-modal-spinner').hide();
        $('#div-modal-status-alert').show();
        createLoggerInfo(":::all_host_glue_config_update_modal() Error ::: error");
        console.log(":::all_host_glue_config_update_modal() Error :::" + data);
    });
});

$('#button-cancel-modal-update-glue-config').on('click', function(){
    $('#div-modal-update-glue-config').hide();
});
$('#button-cancel-modal-pfmp-install').on('click', function(){
    $('#div-modal-pfmp-install').hide();
});
/** all hosts update glue config modal 관련 action end */

/** remove cube host config modal 관련 action start */
// 전체 시스템 종료 버튼 클릭시 modal의 설명 세팅
$('#menu-item-remove-cube-host').on('click',function(){
    $('#div-modal-remove-cube-host').show();
});

$('#button-close-modal-remove-cube-host').on('click', function(){
    $('#div-modal-remove-cube-host').hide();
});

$('#button-execution-modal-remove-cube-host').on('click', function(){
    var console_log = true;
    $('#div-modal-remove-cube-host').hide();
    $('#div-modal-spinner-header-txt').text('Cube 호스트를 초기화하고 있습니다.');
    $('#div-modal-spinner').show();

    $("#modal-status-alert-title").html("Cube 호스트 제거");
    $("#modal-status-alert-body").html("Cube 호스트 제거를 실패하였습니다.");
    createLoggerInfo("remove_cube_host_modal() start");

    /*
    todo list
    1) hosts 파일 초기화
    2) ablestack.json 초기화
    3) cluster.json 초기화
    4) vmconfig 초기화
    */
    cockpit.spawn(["python3", pluginpath+"/python/cluster/remove_cube_host.py", "remove"])
    .then(function(data){
        var retVal = JSON.parse(data);
        if(retVal.code == 200){
            $('#div-modal-spinner').hide();
            $("#modal-status-alert-body").html("Cube 호스트를 초기화를 성공하였습니다");
            $('#div-modal-status-alert').show();
            createLoggerInfo("remove cube host success");
        }else{
            $('#div-modal-spinner').hide();
            $('#div-modal-status-alert').show();
            createLoggerInfo(":::remove_cube_host_modal() Error ::: error");
            console.log(":::remove_cube_host_modal() Error :::" + data);
        }
    })
    .catch(function(data){
        $('#div-modal-spinner').hide();
        $('#div-modal-status-alert').show();
        createLoggerInfo(":::remove_cube_host_modal() Error ::: error");
        console.log(":::remove_cube_host_modal() Error :::" + data);
    });
});

$('#button-cancel-modal-remove-cube-host').on('click', function(){
    $('#div-modal-remove-cube-host').hide();
});
/** move cube host config modal 관련 action end */


/**
 * Meathod Name : checkStorageClusterStatus
 * Date Created : 2021.03.31
 * Writer  : 최진성
 * Description : 스토리지센터 클러스터 상태 조회
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.03.31 최초 작성
 */
function checkStorageClusterStatus(){
    //createLoggerInfo("checkStorageClusterStatus() start");
    return new Promise((resolve) => {
        //초기 상태 체크 중 표시
        $('#scc-status').html("상태 체크 중 &bull;&bull;&bull;&nbsp;&nbsp;&nbsp;<svg class='pf-c-spinner pf-m-md' role='progressbar' aria-valuetext='Loading...' viewBox='0 0 100 100' ><circle class='pf-c-spinner__path' cx='50' cy='50' r='45' fill='none'></circle></svg>");
        $("#scc-css").attr('class','pf-c-label pf-m-orange');
        $("#scc-icon").attr('class','fas fa-fw fa-exclamation-triangle');

        cockpit.spawn(["cat", pluginpath+"/tools/properties/cluster.json"])
        .then(function(data){
            var retVal = JSON.parse(data);
            if (retVal.clusterConfig.type == "PowerFlex"){
                setPfmpStatus();
                //bootstrap.sh을 실행했는지 여부 확인
                cockpit.spawn(["python3", pluginpath+"/python/ablestack_json/ablestackJson.py", "status"])
                .then(function(data){
                    var retVal = JSON.parse(data);
                    if(retVal.val.bootstrap.scvm == "false"){ //bootstrap.sh 실행 전
                        sessionStorage.setItem("scvm_bootstrap_status","false");
                        $("#scvm-after-bootstrap-run").html("");
                        $("#scvm-before-bootstrap-run").html("<a class='pf-c-dropdown__menu-item' href='#' id='menu-item-bootstrap-run' onclick='scvm_bootstrap_run()'>Bootstrap 실행</a>");
                    }else{  //bootstrap.sh 실행 후
                        sessionStorage.setItem("scvm_bootstrap_status","true");
                        $("#scvm-after-bootstrap-run").html("<a class='pf-c-dropdown__menu-item' href='#' id='menu-item-linkto-storage-center' onclick='scc_link_go()'>스토리지센터 연결</a>");
                        $("#scvm-before-bootstrap-run").html("");
                    }
                    //PowerFlex PFMP의 bootstrap 실행전
                    if(retVal.val.bootstrap.pfmp == "false"){
                        sessionStorage.setItem("pfmp_bootstrap_status","false");
                        $("#pfmp-bootstrap-run").html("");
                        $("#pfmp-bootstrap-run").html("<a class='pf-c-dropdown__menu-item pf-m-disabled' href='#' id='menu-item-pfmp-install' onclick='pfmp_install()'>PFMP 설치</a>");
                    }else{  //bootstrap.sh 실행 후
                        sessionStorage.setItem("pfmp_bootstrap_status","true");
                        $("#pfmp-bootstrap-run").hide();
                        $("#pfmp-bootstrap-run").html("");
                    }
                })
                .catch(function(data){
                    createLoggerInfo("Check whether bootstrap.sh is executed Error");
                    console.log(" bootstrap.sh을 실행했는지 여부 확인 Error ::: " + data);
                    $("#scvm-after-bootstrap-run").html("");
                    $("#scvm-before-bootstrap-run").html("");
                });
                cockpit.spawn(["python3", pluginpath + "/python/powerflex_status/powerflex_status.py", "status"])
                .then(function(data){
                    var retVal = JSON.parse(data);
                    var pfmp_bootstrap_status = sessionStorage.getItem("pfmp_bootstrap_status");
                    if (retVal.code == 200){
                        //파워플렉스 상태 상세 조회(API => json 형식)
                        cockpit.spawn(["python3", pluginpath+"/python/powerflex_status/powerflex_status.py","detail"])
                        .then(function(data){
                            var retVal = JSON.parse(data);
                            var sc_status = "Health Err";
                            //Cluster 상태에 대한 값
                            if (retVal.code == 200){
                                if (retVal.val.clusterState == "ClusteredNormal"){
                                    sc_status = "Health Ok";
                                    sessionStorage.setItem("sc_status", "HEALTH_OK");
                                    $('#scc-status-check').text("스토리지센터 클러스터가 구성되었습니다.");
                                    $('#scc-status-check').attr("style","color: var(--pf-global--success-color--100)");
                                    $("#menu-item-linkto-storage-center").removeClass('pf-m-disabled');
                                    $("#menu-item-update-glue-config").removeClass('pf-m-disabled');
                                    $("#scc-css").attr('class','pf-c-label pf-m-green');
                                    $("#scc-icon").attr('class','fas fa-fw fa-check-circle');
                                }else if(retVal.val.clusterState == "ClusteredDegraded"){
                                    sc_status = "Health Warn";
                                    sessionStorage.setItem("sc_status", "HEALTH_WARN");
                                    $('#scc-status-check').text("스토리지센터 클러스터가 구성되었습니다.");
                                    $('#scc-status-check').attr("style","color: var(--pf-global--success-color--100)");
                                    $("#menu-item-linkto-storage-center").removeClass('pf-m-disabled');
                                    $("#menu-item-update-glue-config").removeClass('pf-m-disabled');
                                    $("#scc-css").attr('class','pf-c-label pf-m-orange');
                                    $("#scc-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                                }else{
                                    sc_status = "Health Err";
                                    sessionStorage.setItem("sc_status", "HEALTH_ERR");
                                    $("#scc-css").attr('class','pf-c-label pf-m-red');
                                    $("#scc-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                                    $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                                    $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                                    $('#scc-status-check').text("스토리지센터 클러스터가 구성되지 않았습니다.");
                                    $('#scc-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                                    $("#menu-item-linkto-storage-center").addClass('pf-m-disabled');
                                    $("#menu-item-update-glue-config").addClass('pf-m-disabled');
                                }
                                $('#protect-domain').show();
                                $('#manage-daemon').hide();
                                $('#scc-status').html(sc_status);

                                if(retVal.val.devices[0].total_disks !="N/A" && retVal.val.devices[0].disk_state !="N/A" ){
                                    $('#scc-osd').text("전체 " + retVal.val.devices[0].total_disks + "개의 디스크 중 " + retVal.val.devices[0].disk_state + "개 작동 중");
                                }
                                if(retVal.val.tieBreakers !="N/A" && retVal.val.slave !="N/A"  && retVal.val.master !="N/A" ){
                                    $('#scc-gw').text("PowerFlex GW " + retVal.val.goodNodesNum + "개 실행 중 / " + retVal.val.goodNodesNum + "개 제공 중(quorum : " + retVal.val.master.hostname +","+retVal.val.slaves[0].hostname+","+retVal.val.tieBreakers[0].hostname + ")");
                                }
                                if(retVal.val.protection_domains !="N/A"){
                                    $('#scc-protect-domain').text(retVal.val.protection_domains.length + " 개의 보호도메인")
                                    var len = 0;
                                    for (var i = 0; i < retVal.val.protection_domains.length; i++){
                                        for (var j = 0 ; j < retVal.val.protection_domains[i].storage_pools.length; j++){
                                            len += 1;
                                        }
                                    }
                                    $('#scc-pools').text(len + " 개의 풀");
                                }
                                if(retVal.val.protection_domains[0].capactiy !="N/A" ){
                                    $('#scc-usage').text("전체 " + retVal.val.protection_domains[0].capacity[0].limit_capacity + " 중 " +retVal.val.protection_domains[0].capacity[0].used_capacity+ " 사용 중 (사용가능 " + retVal.val.protection_domains[0].capacity[0].unused_capacity+ ")" );
                                }
                                resolve();
                            }else{
                                sc_status = "Health Err";
                                sessionStorage.setItem("sc_status", sc_status);
                                $("#scc-css").attr('class','pf-c-label pf-m-red');
                                $("#scc-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                                $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                                $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                                $('#scc-status-check').text("스토리지센터 클러스터가 구성되지 않았습니다.");
                                $('#scc-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                                $("#menu-item-linkto-storage-center").addClass('pf-m-disabled');
                                $("#menu-item-update-glue-config").addClass('pf-m-disabled');
                                $('#protect-domain').show();
                                $('#manage-daemon').hide();
                                $('#scc-status').html(sc_status);
                                resolve();
                            }

                        })
                        .catch(function(data){
                            createLoggerInfo(":::checkStorageClusterStatus() Error:::");
                            console.log(":::checkStorageClusterStatus() Error::: "+ data);
                            $('#scc-status-check').text("스토리지센터 클러스터가 구성되지 않았습니다.");
                            $('#scc-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                            $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                            $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                            $("#menu-item-linkto-storage-center").addClass('pf-m-disabled');
                            $("#menu-item-update-glue-config").addClass('pf-m-disabled');
                            $("#menu-item-bootstrap-run").addClass('pf-m-disabled');
                            resolve();
                        });
                    }else{
                        sc_status = "Health Err";
                        sessionStorage.setItem("sc_status", sc_status);
                        $("#scc-css").attr('class','pf-c-label pf-m-red');
                        $("#scc-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                        $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                        $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                        $('#scc-status-check').text("스토리지센터 클러스터가 구성되지 않았습니다.");
                        $('#scc-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                        $("#menu-item-linkto-storage-center").addClass('pf-m-disabled');
                        $("#menu-item-update-glue-config").addClass('pf-m-disabled');
                        $('#protect-domain').show();
                        $('#manage-daemon').hide();
                        $('#scc-status').html(sc_status);
                        resolve();
                    }
                })
                .catch(function(data){
                    createLoggerInfo(":::checkStorageClusterStatus() Error:::");
                    console.log(":::checkStorageClusterStatus() Error::: "+ data);
                    $('#scc-status-check').text("스토리지센터 클러스터가 구성되지 않았습니다.");
                    $('#scc-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                    $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                    $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                    $("#menu-item-linkto-storage-center").addClass('pf-m-disabled');
                    $("#menu-item-update-glue-config").addClass('pf-m-disabled');
                    $("#menu-item-bootstrap-run").addClass('pf-m-disabled');
                    resolve();
                });
            }else{
                    //bootstrap.sh을 실행했는지 여부 확인
                    cockpit.spawn(["python3", pluginpath+"/python/ablestack_json/ablestackJson.py", "status"])
                    .then(function(data){
                        var retVal = JSON.parse(data);
                        if(retVal.val.bootstrap.scvm == "false"){ //bootstrap.sh 실행 전
                            sessionStorage.setItem("scvm_bootstrap_status","false");
                            $("#scvm-after-bootstrap-run").html("");
                            $("#scvm-before-bootstrap-run").html("<a class='pf-c-dropdown__menu-item' href='#' id='menu-item-bootstrap-run' onclick='scvm_bootstrap_run()'>스토리지센터 구성하기</a>");
                        }else{  //bootstrap.sh 실행 후
                            sessionStorage.setItem("scvm_bootstrap_status","true");
                            $("#scvm-after-bootstrap-run").html("<a class='pf-c-dropdown__menu-item' href='#' id='menu-item-linkto-storage-center' onclick='scc_link_go()'>스토리지센터 연결</a>");
                            $("#scvm-after-update-glue-config").html("<a class='pf-c-dropdown__menu-item' href='#' id='menu-item-update-glue-config' onclick='all_host_glue_config_update_modal()'>전체 호스트 Glue 설정 업데이트</a>");
                            $("#scvm-before-bootstrap-run").html("");
                        }
                    })
                    .catch(function(data){
                        createLoggerInfo("Check whether bootstrap.sh is executed Error");
                        console.log(" bootstrap.sh을 실행했는지 여부 확인 Error ::: " + data);
                        $("#scvm-after-bootstrap-run").html("");
                        $("#scvm-before-bootstrap-run").html("");
                    });
                    //스토리지 클러스터 상태 상세조회(ceph -s => json형식)
                    cockpit.spawn(["python3", pluginpath+"/python/scc_status/scc_status_detail.py", "detail" ])
                        .then(function(data){
                            var retVal = JSON.parse(data);
                            var sc_status = "Health Err";
                            var inMessHtml = "";
                            sessionStorage.setItem("sc_status", retVal.val.cluster_status); //스토리지 클러스터 상태값 세션스토리지에 저장
                            sessionStorage.setItem("storage_cluster_maintenance_status", retVal.val.maintenance_status); //스토리지 클러스터 유지보수 상태값 세션스토리지에 저장
                            //스토리지 클러스터 유지보수 상태 확인 후 버튼 disabled 여부 세팅
                            if(retVal.val.maintenance_status){
                                $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                                $("#menu-item-unset-maintenance-mode").removeClass('pf-m-disabled');
                            }else{
                                $("#menu-item-set-maintenance-mode").removeClass('pf-m-disabled');
                                $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                            }
                            //스토리지 클러스터 상태값에 따라 icon 및 색상 변경을 위한 css 설정 값 세팅
                            if(retVal.val.cluster_status == "HEALTH_OK"){
                                sc_status = "Health Ok";
                                $('#scc-status-check').text("스토리지센터 클러스터가 구성되었습니다.");
                                $('#scc-status-check').attr("style","color: var(--pf-global--success-color--100)");
                                $("#menu-item-linkto-storage-center").removeClass('pf-m-disabled');
                                $("#menu-item-update-glue-config").removeClass('pf-m-disabled');
                                $("#scc-css").attr('class','pf-c-label pf-m-green');
                                $("#scc-icon").attr('class','fas fa-fw fa-check-circle');
                            }else if(retVal.val.cluster_status == "HEALTH_WARN"){
                                sc_status = "Health Warn";
                                $('#scc-status-check').text("스토리지센터 클러스터가 구성되었습니다.");
                                $('#scc-status-check').attr("style","color: var(--pf-global--success-color--100)");
                                $("#menu-item-linkto-storage-center").removeClass('pf-m-disabled');
                                $("#menu-item-update-glue-config").removeClass('pf-m-disabled');
                                $("#scc-css").attr('class','pf-c-label pf-m-orange');
                                $("#scc-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                            }else if(retVal.val.cluster_status == "HEALTH_ERR"){
                                sc_status = "Health Err";
                                $("#scc-css").attr('class','pf-c-label pf-m-red');
                                $("#scc-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                                $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                                $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                                $('#scc-status-check').text("스토리지센터 클러스터가 구성되지 않았습니다.");
                                $('#scc-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                                $("#menu-item-linkto-storage-center").addClass('pf-m-disabled');
                                $("#menu-item-update-glue-config").addClass('pf-m-disabled');
                            }
                            $('#manage-daemon').show();
                            //json으로 넘겨 받은 값들 세팅
                            if(retVal.val.cluster_status != "HEALTH_OK"){
                                //json key중 'message'이라는 key의 value값 가져옴
                                const recurse = (obj, arr=[]) => {
                                    Object.entries(obj).forEach(([key, val]) => {
                                        if (key === 'message') {
                                            arr.push(val);
                                        }
                                        if (typeof val === 'object') {
                                            recurse(val, arr);
                                        }
                                    });
                                    return arr;
                                };
                                //health상태가 warn, error일경우 message 정보 확인하기 위함.
                                var messArr = recurse(retVal);
                                for(var i in messArr){
                                    inMessHtml = inMessHtml + "<br> - "  + messArr[i];
                                }
                                $('#scc-status').html(sc_status + inMessHtml);
                            }else{
                                $('#scc-status').html(sc_status);
                            }
                            if(retVal.val.osd !="N/A" && retVal.val.osd_up !="N/A" ){
                                $('#scc-osd').text("전체 " + retVal.val.osd + "개의 디스크 중 " + retVal.val.osd_up + "개 작동 중");
                            }
                            if(retVal.val.mon_gw1 !="N/A" && retVal.val.mon_gw2 !="N/A" ){
                                if(retVal.val.json_raw.health.checks.hasOwnProperty('MON_DOWN')){//health 상태값 중 MON_DOWN 값이 있을때
                                    activeGwCnt = parseInt(retVal.val.mon_gw1) - parseInt(retVal.val.json_raw.health.checks.MON_DOWN.summary.count);//다운된 mon count 확인해 실행중인(activeGwCnt) mon count 값세팅
                                }else{
                                    activeGwCnt = retVal.val.mon_gw1;
                                }
                                $('#scc-gw').text("RBD GW " + activeGwCnt + "개 실행 중 / " + retVal.val.mon_gw1 + "개 제공 중(quorum : " + retVal.val.mon_gw2 + ")");
                            }
                            if(retVal.val.mgr !="N/A" && retVal.val.mgr_cnt !="N/A" ){
                                $('#scc-mgr').text(retVal.val.mgr + "(전체 " + retVal.val.mgr_cnt + "개 실행중)");
                            }
                            if(retVal.val.pools !="N/A"){
                                $('#scc-pools').text(retVal.val.pools + " pools");
                            }
                            if(retVal.val.avail !="N/A" && retVal.val.used !="N/A" && retVal.val.usage_percentage !="N/A" ){
                                $('#scc-usage').text("전체 " + retVal.val.avail + " 중 " +retVal.val.used + " 사용 중 (사용률 " + retVal.val.usage_percentage+ " %)" );
                            }
                            resolve();
                        })
                        .catch(function(data){
                            createLoggerInfo(":::checkStorageClusterStatus() Error:::");
                            console.log(":::checkStorageClusterStatus() Error::: "+ data);
                            $('#scc-status-check').text("스토리지센터 클러스터가 구성되지 않았습니다.");
                            $('#scc-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                            $("#menu-item-set-maintenance-mode").addClass('pf-m-disabled');
                            $("#menu-item-unset-maintenance-mode").addClass('pf-m-disabled');
                            $("#menu-item-linkto-storage-center").addClass('pf-m-disabled');
                            $("#menu-item-update-glue-config").addClass('pf-m-disabled');
                            $("#menu-item-bootstrap-run").addClass('pf-m-disabled');
                            resolve();
                        });
            }//else문
        });

    });
}


/**
 * Meathod Name : checkStorageVmStatus
 * Date Created : 2021.03.31
 * Writer  : 최진성
 * Description : 스토리지센터 가상머신 상태 조회
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.03.31 최초 작성
 */
function checkStorageVmStatus(){
    //createLoggerInfo("checkStorageVmStatus() start");
    return new Promise((resolve) => {
        //초기 상태 체크 중 표시
        $('#scvm-status').html("상태 체크 중 &bull;&bull;&bull;&nbsp;&nbsp;&nbsp;<svg class='pf-c-spinner pf-m-md' role='progressbar' aria-valuetext='Loading...' viewBox='0 0 100 100' ><circle class='pf-c-spinner__path' cx='50' cy='50' r='45' fill='none'></circle></svg>");
        $("#scvm-css").attr('class','pf-c-label pf-m-orange');
        $("#scvm-icon").attr('class','fas fa-fw fa-exclamation-triangle');

        //scvm 상태 조회
        cockpit.spawn(["python3", pluginpath+"/python/scvm_status/scvm_status_detail.py", "detail" ])
            .then(function(data){
                var retVal = JSON.parse(data);
                sessionStorage.setItem("scvm_status", retVal.val.scvm_status.toUpperCase());//스트리지센터 가상머신 상태값 세션스토리지에 저장
                sessionStorage.setItem("scvm_cpu", retVal.val.vcpu);//스트리지센터 가상머신 상태값 세션스토리지에 저장
                sessionStorage.setItem("scvm_momory", retVal.val.memory);//스트리지센터 가상머신 상태값 세션스토리지에 저장

                //json으로 넘겨 받은 값들 세팅
                var scvm_status = retVal.val.scvm_status;
                if(scvm_status == "running"){
                    scvm_status = "Running";
                }else if(scvm_status == "shut off"){
                    scvm_status = "Stopped";
                }else{
                    scvm_status = "Health Err";
                }
                $('#scvm-status').text(scvm_status);
                if(retVal.val.vcpu !="N/A"){
                    $('#scvm-cpu').text(retVal.val.vcpu + " vCore");
                }
                //$('#scvm-cpu').text(retVal.val.vcpu + "vCore(" + retVal.val.socket + " Socket, "+retVal.val.core+" Core)");
                if(retVal.val.memory !="N/A"){
                    $('#scvm-memory').text(retVal.val.memory);
                }
                if(retVal.val.rootDiskSize !="N/A" && retVal.val.rootDiskAvail !="N/A" && retVal.val.rootDiskUsePer !="N/A"){
                    $('#scvm-rdisk').text(retVal.val.rootDiskSize + "(사용가능 " + retVal.val.rootDiskAvail + " / 사용률 " + retVal.val.rootDiskUsePer + ")");
                }
                if(retVal.val.manageNicType !="N/A" && retVal.val.manageNicParent !="N/A"){
                    $('#scvm-manage-nic-type').text("NIC Type : " + retVal.val.manageNicType + " (Parent : " + retVal.val.manageNicParent + ")");
                }
                if(retVal.val.manageNicIp !="N/A"){
                    $('#scvm-manage-nic-ip').text("IP : " + retVal.val.manageNicIp.split("/")[0]);
                    $('#scvm-manage-nic-ip-prefix').text("PREFIX : " + retVal.val.manageNicIp.split("/")[1]);
                }
                if(retVal.val.manageNicGw !="N/A"){
                    $('#scvm-manage-nic-gw').text("GW : " + retVal.val.manageNicGw);
                }
                if(retVal.val.manageNicDns != "N/A"){
                    $('#scvm-manage-nic-dns').text("DNS : " + retVal.val.manageNicDns);
                }
                if(retVal.val.storageServerNicType !="N/A"){
                    $('#scvm-storage-server-nic-type').text("서버용 NIC Type : " + retVal.val.storageServerNicType);
                    if( retVal.val.storageServerNicParent !="N/A"){
                        $('#scvm-storage-server-nic-type').text("서버용 NIC Type : " + retVal.val.storageServerNicType + " (Parent : " + retVal.val.storageServerNicParent + ")");
                    }
                }
                if(retVal.val.storageServerNicIp !="N/A"){
                    $('#scvm-storage-server-nic-ip').text("서버용 IP : " + retVal.val.storageServerNicIp);
                }
                if(retVal.val.storageReplicationNicType !="N/A"){
                    $('#scvm-storage-replication-nic-type').text("복제용 NIC Type : " + retVal.val.storageReplicationNicType);
                    if( retVal.val.storageReplicationNicParent !="N/A"){
                        $('#scvm-storage-replication-nic-type').text("복제용 NIC Type : " + retVal.val.storageReplicationNicType + " (Parent : " + retVal.val.storageReplicationNicParent + ")");
                    }
                }
                if(retVal.val.storageReplicationNicIp !="N/A"){
                    $('#scvm-storage-replication-nic-ip').text("복제용 IP : " + retVal.val.storageReplicationNicIp);
                }
                if(retVal.val.dataDiskType !="N/A"){
                    $('#scvm-storage-datadisk-type').text("Disk Type : " + retVal.val.dataDiskType);
                }

                //스토리지 센터 가상머신 toggle세팅
                if(retVal.val.scvm_status == "running"){ //가상머신 상태가 running일 경우
                    $("#scvm-css").attr('class','pf-c-label pf-m-green');
                    $("#scvm-icon").attr('class','fas fa-fw fa-check-circle');
                    $('#scvm-deploy-status-check').text("스토리지센터 가상머신이 배포되었습니다.");
                    $('#scvm-deploy-status-check').attr("style","color: var(--pf-global--success-color--100)");
                    $("#menu-item-set-storage-center-vm-start").addClass('pf-m-disabled');
                    $("#menu-item-set-storage-center-vm-resource-update").addClass('pf-m-disabled');
                    $("#menu-item-linkto-storage-center-vm").removeClass('pf-m-disabled');
                    if(sessionStorage.getItem("sc_status") == "HEALTH_ERR"){ //가상머신 상태 running && sc상태 Error 일때
                        $("#menu-item-set-storage-center-vm-delete").removeClass('pf-m-disabled');
                    }else{ //가상머신 상태 running && sc상태 ok, warn 일때
                        $("#menu-item-set-storage-center-vm-delete").addClass('pf-m-disabled');
                    }
                    if (os_type == "ABLESTACK-HCI"){
                        if(sessionStorage.getItem("storage_cluster_maintenance_status") == "true"){ //가상머신 상태 running && sc 유지보수모드일때
                            $("#menu-item-set-storage-center-vm-stop").removeClass('pf-m-disabled');
                        }else{//가상머신 상태 running && sc 유지보수모드 아닐때
                            $("#menu-item-set-storage-center-vm-stop").addClass('pf-m-disabled');
                        }
                    }else{
                        $("#menu-item-set-storage-center-vm-stop").removeClass('pf-m-disabled');
                    }
                }else if(retVal.val.scvm_status == "shut off"){ //가상머신 상태가 shut off일 경우
                    $("#scvm-css").attr('class','pf-c-label pf-m-red');
                    $("#scvm-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                    $('#scvm-deploy-status-check').text("스토리지센터 가상머신이 배포되었습니다.");
                    $('#scvm-deploy-status-check').attr("style","color: var(--pf-global--success-color--100)");
                    $("#menu-item-set-storage-center-vm-start").removeClass('pf-m-disabled');
                    $("#menu-item-set-storage-center-vm-stop").addClass('pf-m-disabled');
                    $("#menu-item-set-storage-center-vm-delete").removeClass('pf-m-disabled');
                    $("#menu-item-set-storage-center-vm-resource-update").attr('class','pf-c-dropdown__menu-item');
                    $("#menu-item-linkto-storage-center-vm").addClass('pf-m-disabled');
                }else{//가상머신 상태가 health_err일 경우
                    $("#scvm-css").attr('class','pf-c-label pf-m-red');
                    $("#scvm-icon").attr('class','fas fa-fw fa-exclamation-triangle');
                    $('#scvm-deploy-status-check').text("스토리지센터 가상머신이 배포되지 않았습니다.");
                    $('#scvm-deploy-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                    $("#menu-item-set-storage-center-vm-start").addClass('pf-m-disabled');
                    $("#menu-item-set-storage-center-vm-stop").addClass('pf-m-disabled');
                    $("#menu-item-set-storage-center-vm-delete").addClass('pf-m-disabled');
                    $("#menu-item-set-storage-center-vm-resource-update").addClass('pf-m-disabled');
                    $("#menu-item-linkto-storage-center-vm").addClass('pf-m-disabled');
                    $("#menu-item-bootstrap-run").addClass('pf-m-disabled');
                }
                resolve();
            })
            .catch(function(data){
                createLoggerInfo(":::checkStorageVmStatus Error:::");
                console.log(":::checkStorageVmStatus Error:::" + data);
                $("#menu-item-set-storage-center-vm-start").addClass('pf-m-disabled');
                $("#menu-item-set-storage-center-vm-stop").addClass('pf-m-disabled');
                $("#menu-item-set-storage-center-vm-delete").addClass('pf-m-disabled');
                $("#menu-item-set-storage-center-vm-resource-update").addClass('pf-m-disabled');
                $("#menu-item-linkto-storage-center-vm").addClass('pf-m-disabled');
                $('#scvm-deploy-status-check').text("스토리지센터 가상머신이 배포되지 않았습니다.");
                $('#scvm-deploy-status-check').attr("style","color: var(--pf-global--danger-color--100)");
                resolve();
            });
        //스토리지 클러스터 배포 여부 확인 후 스토리지센터 가상머신 삭제 버튼 disabled 여부 세팅
        if(sessionStorage.getItem("sc_status") == "HEALTH_ERR"){
            $("#menu-item-set-storage-center-vm-delete").removeClass('class','pf-m-disabled');
        }else{
            $("#menu-item-set-storage-center-vm-delete").addClass('class','pf-m-disabled');
        }
    });
}

function sleep(sec) {
    let start = Date.now(), now = start;
    while (now - start < sec * 1000) {
        now = Date.now();
    }
}

/**
 * Meathod Name : checkDeployStatus
 * Date Created : 2021.03.30
 * Writer  : 박다정
 * Description : 요약리본 UI 배포상태에 따른 이벤트 처리
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.03.30 최초 작성
 */
function checkDeployStatus(){
    setTimeout(function(){
        // 배포 상태 조회 전 버튼 hide 처리
        $('#button-open-modal-wizard-storage-cluster').hide();
        $('#button-open-modal-wizard-storage-vm').hide();
        $('#button-open-modal-wizard-pfmp-vm').hide();
        $('#button-open-modal-wizard-cloud-vm').hide();
        $('#button-link-storage-center-dashboard').hide();
        $('#button-link-cloud-center').hide();
        $('#button-open-modal-wizard-monitoring-center').hide();
        $('#button-link-monitoring-center').hide();
        $('#button-config-file-download').hide();
        /*
        가상머신 배포 및 클러스터 구성 상태를 세션 스토리지에서 조회
        - 클러스터 구성준비 상태 = false, true
        - 스토리지센터 가상머신 상태 = HEALTH_ERR(배포x), RUNNING, SHUT OFF 등
        - 스토리지센터 가상머신 부트스트랩 실행 상태 = false, true
        - 스토리지센터 클러스터 상태 = HEALTH_ERR(구성x), HEALTH_OK, HEALTH_WARN 등
        - 클라우드센터 클러스터 상태 = HEALTH_ERR1(구성x), HEALTH_ERR2(리소스 구성x), HEALTH_OK
        - 클라우드센터 가상머신 상태 = HEALTH_ERR(배포x), RUNNING, SHUT OFF 등
        - 클라우드센터 가상머신 부트스트랩 실행 상태 = false, true
        */
        const os_type = sessionStorage.getItem("os_type");
        const step1 = sessionStorage.getItem("ccfg_status");
        const step2 = sessionStorage.getItem("scvm_status");
        const step3 = sessionStorage.getItem("scvm_bootstrap_status");
        const step4 = sessionStorage.getItem("sc_status");
        const step5 = sessionStorage.getItem("cc_status");
        const step6 = sessionStorage.getItem("ccvm_status");
        const step7 = sessionStorage.getItem("ccvm_bootstrap_status");
        const step8 = sessionStorage.getItem("wall_monitoring_status");

        // PowerFlex용 sessionStorage
        const step9 = sessionStorage.getItem("pfmp_status");
        const step10 = sessionStorage.getItem("pfmp_bootstrap_status");

        // 배포 상태조회
        if (os_type == "ABLESTACK-HCI"){
            console.log("step1 :: " + step1 + ", step2 :: " + step2 + " , step3 :: " + step3 + ", step4 :: " + step4 + ", step5 :: " + step5 + ", step6 :: " + step6 + ", step7 :: " + step7 + ", step8 :: " + step8);

            if(step1!="true"){
                // 클러스터 구성준비 버튼 show
                $('#button-open-modal-wizard-storage-cluster').show();
                showRibbon('warning','스토리지센터 및 클라우드센터 VM이 배포되지 않았습니다. 클러스터 구성준비를 진행하십시오.');
            }else{
                $('#button-config-file-download').show();
                if(step2=="HEALTH_ERR"||step2==null){
                    // 클러스터 구성준비 버튼, 스토리지센터 VM 배포 버튼 show
                    $('#button-open-modal-wizard-storage-cluster').show();
                    $('#button-open-modal-wizard-storage-vm').show();
                    showRibbon('warning','스토리지센터 및 클라우드센터 VM이 배포되지 않았습니다. 스토리지센터 VM 배포를 진행하십시오.');
                }else{
                    if(step3!="true"){
                        showRibbon('warning','스토리지센터 대시보드에 연결할 수 있도록 스토리지센터 VM Bootstrap 실행 작업을 진행하십시오.');
                    }else{
                        if(step8!="true" && step4=="Health Err"||step4==null){
                            // 스토리지센터 연결 버튼 show
                            $('#button-open-modal-wizard-cloud-vm').show();
                            $('#button-link-storage-center-dashboard').show();
                            showRibbon('warning','클라우드센터 VM이 배포되지 않았습니다. 스토리지센터에 연결하여 스토리지 클러스터 구성한 후 클라우드센터 VM 배포를 진행하십시오.');
                        }else{
                            if(step8!="true" && step5=="HEALTH_ERR1"||step5=="HEALTH_ERR2"||step5==null){
                                //클라우드센터 VM 배포 버튼, 스토리지센터 연결 버튼 show
                                $('#button-open-modal-wizard-cloud-vm').show();
                                $('#button-link-storage-center-dashboard').show();
                                if(step8!="true" && step5=="HEALTH_ERR1"||step5==null){
                                    showRibbon('warning','클라우드센터 클러스터가 구성되지 않았습니다. 클라우드센터 클러스터 구성을 진행하십시오.');
                                }else{
                                    showRibbon('warning','클라우드센터 클러스터는 구성되었으나 리소스 구성이 되지 않았습니다. 리소스 구성을 진행하십시오.');
                                }
                            }else{
                                if(step8!="true" && step6=="HEALTH_ERR"||step6==null){
                                    //클라우드센터 VM 배포 버튼, 스토리지센터 연결 버튼 show
                                    $('#button-open-modal-wizard-cloud-vm').show();
                                    $('#button-link-storage-center-dashboard').show();
                                    showRibbon('warning','클라우드센터 VM이 배포되지 않았습니다. 클라우드센터 VM 배포를 진행하십시오.');
                                }else{
                                    if(step8!="true" && step7!="true"){
                                        showRibbon('warning','클라우드센터에 연결할 수 있도록 클라우드센터 VM Bootstrap 실행 작업을 진행하십시오.');
                                    }else{
                                        // 스토리지센터 연결 버튼, 클라우드센터 연결 버튼 show, 모니터링센터 구성 버튼 show
                                        $('#button-link-storage-center-dashboard').show();
                                        $('#button-link-cloud-center').show();

                                        if(step8!="true"){
                                            $('#button-open-modal-wizard-monitoring-center').show();
                                            showRibbon('warning','모니터링센터에 연결할 수 있도록 모니터링센터 구성 작업을 진행하십시오.');
                                        }else{
                                            // 모니터링센터 구성 연결 버튼 show
                                            $('#button-link-monitoring-center').show();

                                            showRibbon('success','ABLESTACK 스토리지센터 및 클라우드센터 VM 배포되었으며 모니터링센터 구성이 완료되었습니다. 가상어플라이언스 상태가 정상입니다.');
                                            // 운영 상태조회
                                            let msg ="";
                                            if(step2!="RUNNING"){
                                                msg += '스토리지센터 가상머신이 '+step2+' 상태 입니다.\n';
                                                msg += '스토리지센터 가상머신이 shut off 상태일 경우 스토리지센터 가상머신 카드에서 스토리지센터 VM을 시작해주세요.\n';
                                                showRibbon('warning', msg);
                                            }
                                            if(step4!="HEALTH_OK"){
                                                msg += '스토리지센터 클러스터가 '+step4+' 상태 입니다.\n';
                                                msg += 'oout, nobackfill, norecover flag인 경우 의도하지 않은 유지보수 모드일 경우 스토리지센터 클러스터 상태 카드에서 유지보수 모드 해제해주세요.\n';
                                                msg += '스토리지센터 클러스터 상태가 Monitor clock detected 인 경우 cube host, scvm, ccvm의 ntp 시간 동기화 작업을 해야합니다.';
                                                showRibbon('warning', msg);
                                            }
                                            if(step6!="RUNNING"){
                                                msg += '클라우드센터 가상머신이 '+step6+' 상태 입니다.\n';
                                                msg += '클라우드센터 가상머신 Mold 서비스 , DB 상태를 확인하여 정지상태일 경우 서비스 재시작\n';
                                                msg += '또는 클라우드센터 클러스터 상태 카드에서 가상머신 시작하여 문제를 해결할 수 있습니다.';
                                                showRibbon('warning', msg);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }else if (os_type == "PowerFlex"){
            console.log("step1 :: " + step1 + ", step2 :: " + step2 + " , step3 :: " + step3 + ", step4 :: " + step4 + ", step5 :: " + step5 + ", step6 :: " + step6 + ", step7 :: " + step7 + ", step8 :: " + step8 + ", stpe9 :: " + step9 + ", step10 :: " + step10);
            if(step1!="true"){
                // 클러스터 구성준비 버튼 show
                $('#button-open-modal-wizard-storage-cluster').show();
                showRibbon('warning','스토리지센터 및 파워플렉스 관리 플랫폼 및 클라우드센터 VM이 배포되지 않았습니다. 클러스터 구성준비를 진행하십시오.');
            }else{
                $('#button-config-file-download').show();
                if(step2=="HEALTH_ERR"||step2==null){
                    // 클러스터 구성준비 버튼, 스토리지센터 VM 배포 버튼 show
                    $('#button-open-modal-wizard-storage-cluster').show();
                    $('#button-open-modal-wizard-storage-vm').show();
                    showRibbon('warning','스토리지센터 및 파워 플렉스 관리 플랫폼 및 클라우드센터 VM이 배포되지 않았습니다. 스토리지센터 VM 배포를 진행하십시오.');
                }else{
                    if(step3!="true"){
                        showRibbon('warning','스토리지센터의 설정을 위해 스토리지센터 VM Bootstrap 실행 작업을 진행하십시오.');
                    }else{
                        //여기서 들어가야지 pfmp에 대한
                        if(step8!="true" && ((step9=="HEALTH_ERR"||step9=="null") && step10 == "false")){
                            $('#button-open-modal-wizard-pfmp-vm').show();
                            showRibbon('warning','파워플렉스 관리 플랫폼 VM이 배포되지 않았습니다. 파워플렉스 관리 플랫폼 VM 배포를 진행하십시오.');
                            if(step10 == "true"){
                                if(step8!="true" && (step5=="HEALTH_ERR1"||step5=="HEALTH_ERR2"||step5==null)){
                                    //클라우드센터 VM 배포 버튼, 스토리지센터 연결 버튼 show
                                    $('#button-open-modal-wizard-cloud-vm').show();
                                    $('#button-link-storage-center-dashboard').show();
                                    if(step8!="true" && step5=="HEALTH_ERR1"||step5==null){
                                        showRibbon('warning','클라우드센터 클러스터가 구성되지 않았습니다. 클라우드센터 클러스터 구성을 진행하십시오.');
                                    }else{
                                        showRibbon('warning','클라우드센터 클러스터는 구성되었으나 리소스 구성이 되지 않았습니다. 리소스 구성을 진행하십시오.');
                                    }
                                }else{
                                    if(step8!="true" && (step6=="HEALTH_ERR"||step6==null)){
                                        //클라우드센터 VM 배포 버튼, 스토리지센터 연결 버튼 show
                                        $('#button-open-modal-wizard-cloud-vm').show();
                                        $('#button-link-storage-center-dashboard').show();
                                        showRibbon('warning','클라우드센터 VM이 배포되지 않았습니다. 클라우드센터 VM 배포를 진행하십시오.');
                                    }else{
                                        if(step8!="true" && step7!="true"){
                                            showRibbon('warning','클라우드센터에 연결할 수 있도록 클라우드센터 VM Bootstrap 실행 작업을 진행하십시오.');
                                        }else{
                                            // 스토리지센터 연결 버튼, 클라우드센터 연결 버튼 show, 모니터링센터 구성 버튼 show
                                            $('#button-link-storage-center-dashboard').show();
                                            $('#button-link-cloud-center').show();

                                            if(step8!="true"){
                                                $('#button-open-modal-wizard-monitoring-center').show();
                                                showRibbon('warning','모니터링센터에 연결할 수 있도록 모니터링센터 구성 작업을 진행하십시오.');
                                            }else{
                                                // 모니터링센터 구성 연결 버튼 show
                                                $('#button-link-monitoring-center').show();

                                                showRibbon('success','ABLESTACK 스토리지센터 및 클라우드센터 VM 배포되었으며 모니터링센터 구성이 완료되었습니다. 가상어플라이언스 상태가 정상입니다.');
                                                // 운영 상태조회
                                                let msg ="";
                                                if(step2!="RUNNING"){
                                                    msg += '스토리지센터 가상머신이 '+step2+' 상태 입니다.\n';
                                                    msg += '스토리지센터 가상머신이 shut off 상태일 경우 스토리지센터 가상머신 카드에서 스토리지센터 VM을 시작해주세요.\n';
                                                    showRibbon('warning', msg);
                                                }
                                                if(step4!="HEALTH_OK"){
                                                    msg += '스토리지센터 클러스터가 '+step4+' 상태 입니다.\n';
                                                    msg += 'oout, nobackfill, norecover flag인 경우 의도하지 않은 유지보수 모드일 경우 스토리지센터 클러스터 상태 카드에서 유지보수 모드 해제해주세요.\n';
                                                    msg += '스토리지센터 클러스터 상태가 Monitor clock detected 인 경우 cube host, scvm, ccvm의 ntp 시간 동기화 작업을 해야합니다.';
                                                    showRibbon('warning', msg);
                                                }
                                                if(step6!="RUNNING"){
                                                    msg += '클라우드센터 가상머신이 '+step6+' 상태 입니다.\n';
                                                    msg += '클라우드센터 가상머신 Mold 서비스 , DB 상태를 확인하여 정지상태일 경우 서비스 재시작\n';
                                                    msg += '또는 클라우드센터 클러스터 상태 카드에서 가상머신 시작하여 문제를 해결할 수 있습니다.';
                                                    showRibbon('warning', msg);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }else{
                            if(step10!="true"){
                                $('#menu-item-pfmp-install').removeClass('pf-m-disabled');
                                showRibbon('warning','파워플렉스 관리 플랫폼의 쿠버네티스 설정을 위해 파워플렉스 관리 플랫폼 VM Bootstrap 실행 작업을 진행하십시오.');
                            }else{
                                if(step8!="true" && (step5=="HEALTH_ERR1"||step5=="HEALTH_ERR2"||step5==null)){
                                    //클라우드센터 VM 배포 버튼
                                    $('#button-open-modal-wizard-cloud-vm').show();
                                    $('#button-link-storage-center-dashboard').show();
                                    if(step8!="true" && (step5=="HEALTH_ERR1"||step5==null)){
                                        showRibbon('warning','클라우드센터 클러스터가 구성되지 않았습니다. 클라우드센터 클러스터 구성을 진행하십시오.');
                                    }else{
                                        showRibbon('warning','클라우드센터 클러스터는 구성되었으나 리소스 구성이 되지 않았습니다. 리소스 구성을 진행하십시오.');
                                    }
                                }else{
                                    if(step8!="true" && (step6=="HEALTH_ERR"||step6==null)){
                                        //클라우드센터 VM 배포 버튼, 스토리지센터 연결 버튼 show
                                        $('#button-open-modal-wizard-cloud-vm').show();
                                        $('#button-link-storage-center-dashboard').show();
                                        showRibbon('warning','클라우드센터 VM이 배포되지 않았습니다. 클라우드센터 VM 배포를 진행하십시오.');
                                    }else{
                                        if(step8!="true" && step7!="true"){
                                            showRibbon('warning','클라우드센터에 연결할 수 있도록 클라우드센터 VM Bootstrap 실행 작업을 진행하십시오.');
                                        }else{
                                            // 스토리지센터 연결 버튼, 클라우드센터 연결 버튼 show, 모니터링센터 구성 버튼 show
                                            $('#button-link-storage-center-dashboard').show();
                                            $('#button-link-cloud-center').show();

                                            if(step8!="true"){
                                                $('#button-open-modal-wizard-monitoring-center').show();
                                                showRibbon('warning','모니터링센터에 연결할 수 있도록 모니터링센터 구성 작업을 진행하십시오.');
                                            }else{
                                                // 모니터링센터 구성 연결 버튼 show
                                                $('#button-link-monitoring-center').show();

                                                showRibbon('success','ABLESTACK 스토리지센터 및 클라우드센터 VM 배포되었으며 모니터링센터 구성이 완료되었습니다. 가상어플라이언스 상태가 정상입니다.');
                                                // 운영 상태조회
                                                let msg ="";
                                                if(step2!="RUNNING"){
                                                    msg += '스토리지센터 가상머신이 '+step2+' 상태 입니다.\n';
                                                    msg += '스토리지센터 가상머신이 shut off 상태일 경우 스토리지센터 가상머신 카드에서 스토리지센터 VM을 시작해주세요.\n';
                                                    showRibbon('warning', msg);
                                                }
                                                if(step4!="HEALTH_OK"){
                                                    msg += '스토리지센터 클러스터가 '+step4+' 상태 입니다.\n';
                                                    msg += 'oout, nobackfill, norecover flag인 경우 의도하지 않은 유지보수 모드일 경우 스토리지센터 클러스터 상태 카드에서 유지보수 모드 해제해주세요.\n';
                                                    msg += '스토리지센터 클러스터 상태가 Monitor clock detected 인 경우 cube host, scvm, ccvm의 ntp 시간 동기화 작업을 해야합니다.';
                                                    showRibbon('warning', msg);
                                                }
                                                if(step6!="RUNNING"){
                                                    msg += '클라우드센터 가상머신이 '+step6+' 상태 입니다.\n';
                                                    msg += '클라우드센터 가상머신 Mold 서비스 , DB 상태를 확인하여 정지상태일 경우 서비스 재시작\n';
                                                    msg += '또는 클라우드센터 클러스터 상태 카드에서 가상머신 시작하여 문제를 해결할 수 있습니다.';
                                                    showRibbon('warning', msg);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }else if (os_type == "general-virtualization"){
            console.log("step1 :: " + step1 + ", step5 :: " + step5 + ", step6 :: " + step6 + ", step7 :: " + step7 + ", step8 :: " + step8);

            if (step1 != "true"){
                $('#button-open-modal-wizard-storage-cluster').show();
                showRibbon('warning','클라우드센터 VM이 배포되지 않았습니다. 클러스터 구성준비를 진행하십시오.');
            }else{
                $('#button-config-file-download').show();
                if(step8!="true" && step5=="HEALTH_ERR1"||step5=="HEALTH_ERR2"||step5==null){
                    //클라우드센터 VM 배포 버튼
                    $('#button-open-modal-wizard-storage-cluster').show();
                    $('#button-open-modal-wizard-cloud-vm').show();
                    if(step8!="true" && step5=="HEALTH_ERR1"||step5==null){
                        showRibbon('warning','클라우드센터 클러스터가 구성되지 않았습니다. 클라우드센터 클러스터 구성을 진행하십시오.');
                    }else{
                        showRibbon('warning','클라우드센터 클러스터는 구성되었으나 리소스 구성이 되지 않았습니다. 리소스 구성을 진행하십시오.');
                    }
                }else{
                    if(step8!="true" && (step7!="true" && (step6=="HEALTH_ERR"||step6==null))){
                        //클라우드센터 VM 배포 버튼
                        $('#button-open-modal-wizard-cloud-vm').show();
                        showRibbon('warning','클라우드센터 VM이 배포되지 않았습니다. 클라우드센터 VM 배포를 진행하십시오.');
                    }else{
                        if(step8!="true" && step7!="true"){
                            showRibbon('warning','클라우드센터에 연결할 수 있도록 클라우드센터 VM Bootstrap 실행 작업을 진행하십시오.');
                        }else{
                            // 스토리지센터 연결 버튼, 클라우드센터 연결 버튼 show, 모니터링센터 구성 버튼 show
                            $('#button-link-cloud-center').show();

                            if(step8!="true"){
                                $('#button-open-modal-wizard-monitoring-center').show();
                                showRibbon('warning','모니터링센터에 연결할 수 있도록 모니터링센터 구성 작업을 진행하십시오.');
                            }else{
                                // 모니터링센터 구성 연결 버튼 show
                                $('#button-link-monitoring-center').show();

                                showRibbon('success','ABLESTACK 클라우드센터 VM 배포되었으며 모니터링센터 구성이 완료되었습니다. 가상어플라이언스 상태가 정상입니다.');
                                // 운영 상태조회
                                let msg ="";
                                if (step6 != null){
                                    if(step6!="RUNNING"){
                                        msg += '클라우드센터 가상머신이 '+step6+' 상태 입니다.\n';
                                        msg += '클라우드센터 가상머신 Mold 서비스 , DB 상태를 확인하여 정지상태일 경우 서비스 재시작\n';
                                        msg += '또는 클라우드센터 클러스터 상태 카드에서 가상머신 시작하여 문제를 해결할 수 있습니다.';
                                        showRibbon('warning', msg);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }else{
            $('#button-open-modal-wizard-storage-cluster').show();
            showRibbon('warning','스토리지센터 및 클라우드센터 VM이 배포되지 않았습니다. 클러스터 구성준비를 진행하십시오.');
        }
    },200);


}

/**
 * Meathod Name : showRibbon
 * Date Created : 2021.03.23
 * Writer  : 박다정
 * Description : 배포 및 운영 상태에 따른 요약리본 알림메세지 및 class 속성 변경
 * Parameter : (String) status, (String) description
 * Return  : 없음
 * History  : 2021.03.23 최초 작성
 */
function showRibbon(status, description) {
    $('#ribbon').attr('class','pf-c-alert pf-m-'+status)
    if(status =='success'){
        $('#main-ribbon').text('Success alert:');
    }
    let alert_text = $('#main-ribbon-description').text(description);
    alert_text.html(alert_text.html().replace(/\n/g, '<br/>'));
}

/**
 * Meathod Name : saveHostInfo
 * Date Created : 2021.04.01
 * Writer  : 박다정
 * Description : 호스트 파일 정보를 세션스토리지에 저장
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.04.01 최초 작성
 */
function saveHostInfo(){
    //createLoggerInfo("saveHostInfo() start");
    cockpit.spawn(['cat', '/etc/hosts'])
    .then(function(data){
        var line = data.split("\n");
        for(var i=0; i<line.length; i++){
            var word = line[i].split("\t");
            if(word.length>1){
                sessionStorage.setItem(word[1], word[0]);
            }
        }
    })
    .catch(function(error){
        createLoggerInfo("Hosts file is not configured error");
        console.log("Hosts file is not configured :"+error);
    });
}



/**
 * Meathod Name : scanHostKey
 * Date Created : 2021.04.14
 * Writer  : 박다정
 * Description : 호스트 키 스캔
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.04.14 최초 작성
 */
 function scanHostKey(){
    //createLoggerInfo("scanHostKey() start");
    cockpit.spawn(['python3', pluginpath + '/python/host/ssh-scan.py'])
    .then(function(data){
        console.log("keyscan ok");
    })
    .catch(function(err){
        createLoggerInfo("keyscan err");
        console.log("keyscan err : " + err);
    });
}

/**
 * Meathod Name : pcsExeHost
 * Date Created : 2022.09.14
 * Writer  : 배태주
 * Description : pcs 클러스터 명령이 가능한 호스트의 정보를 세팅하는 함수
 * Parameter : 없음
 * Return  : 없음
 * History  : 2022.09.14 최초 작성
 */
 function pcsExeHost(){
    cockpit.spawn(['python3', pluginpath + '/python/pcs/pcsExehost.py'])
    .then(function (data) {
        let retVal = JSON.parse(data);
        pcs_exe_host = retVal.val;
    })
    .catch(function (err) {
        createLoggerInfo("pcsExeHost err");
        console.log("pcsExeHost err : " + err);
    });
}

/**
 * Meathod Name : resetBootstrap
 * Date Created : 2021.04.14
 * Writer  : 박다정
 * Description : 클러스터 구성 전인 경우 bootstrap 관련 프로퍼티 초기화
 * Parameter : 없음
 * Return  : 없음
 * History  : 2021.04.14 최초 작성
 */
 function resetBootstrap(){
    createLoggerInfo("resetBootstrap() start");
    //scvm bootstrap 프로퍼티 초기화
    cockpit.spawn(["python3", pluginpath+"/python/ablestack_json/ablestackJson.py", "update", "--depth1", "bootstrap", "--depth2", "scvm", "--value", "false"])
    .then(function(data){
        createLoggerInfo("resetBootstrap scvm ok");
        console.log("resetBootstrap scvm ok");
    })
    .catch(function(err){
        createLoggerInfo("resetBootstrap scvm err");
        console.log("resetBootstrap scvm err : " + err);
    });
    //ccvm bootstrap 프로퍼티 초기화
    cockpit.spawn(["python3", pluginpath+"/python/ablestack_json/ablestackJson.py", "update", "--depth1", "bootstrap", "--depth2", "ccvm", "--value", "false"])
    .then(function(data){
        createLoggerInfo("resetBootstrap ccvm ok");
        console.log("resetBootstrap ccvm ok");
    })
    .catch(function(err){
        createLoggerInfo("resetBootstrap ccvm err");
        console.log("resetBootstrap ccvm err : " + err);
    });
    //wall monitoring 프로퍼티 초기화
    cockpit.spawn(["python3", pluginpath+"/python/ablestack_json/ablestackJson.py", "update", "--depth1", "monitoring", "--depth2", "wall", "--value", "false"])
    .then(function(data){
        createLoggerInfo("resetBootstrap wall ok");
        console.log("resetBootstrap wall ok");
    })
    .catch(function(err){
        createLoggerInfo("resetBootstrap wall err");
        console.log("resetBootstrap wall err : " + err);
    });
}

function ribbonWorker() {
    if (os_type == "general-virtualization"){
        Promise.all([
            pcsExeHost(),
            checkConfigStatus(),
            CardCloudClusterStatus(),
            new CloudCenterVirtualMachine().checkCCVM()
        ])
            .then(function () {
                scanHostKey();
            })
            .finally(function () {
                checkDeployStatus();
            });
    }else{
        Promise.all([pcsExeHost(), checkConfigStatus(), checkStorageClusterStatus(),
            checkStorageVmStatus(), CardCloudClusterStatus(), new CloudCenterVirtualMachine().checkCCVM()]).then(function(){
                scanHostKey();
                checkDeployStatus();
        });
    }
}

/**
 * Meathod Name : readFile
 * Date Created : 2021.10.21
 * Writer  : 류홍욱
 * Description : DB Dump 파일을 로컬 저장소에 저장하고 다운로드 링크를 생성하는 함수
 * Parameter : file_path
 * Return  : 없음
 * History  : 2021.10.26 수정
 */
 async function readFile(file_path) {
    // 파일명에 날짜 출력을 위한 코드
    let today = new Date();
    let year = today.getFullYear();
    let month = ('0' + (today.getMonth() + 1)).slice(-2);
    let day = ('0' + today.getDate()).slice(-2);
    let date_string = year+month+day;
    let hours = ('0' + today.getHours()).slice(-2);
    let minutes = ('0' + today.getMinutes()).slice(-2);
    let seconds = ('0' + today.getSeconds()).slice(-2);
    let time_string = hours+ minutes+seconds;

    // ccvm에서 mysqldump 파일을 생성하는 파이썬 파일 실행
    let result="";
    await cockpit.spawn(['/usr/bin/python3', pluginpath+'/python/vm/dump_ccvm.py'])
    .then(function(data){
        let retVal = JSON.parse(data);
        if (retVal.code == 200) {
            createLoggerInfo("Creation of mysqldump of ccvm is completed");
            console.log("Creation of mysqldump of ccvm is completed");
            result="200";
        }else {
            $('#div-db-backup').show();
            $('#div-db-backup').text("클라우드센터 가상머신의 데이터베이스 백업이 실패하었습니다.");
            $('#dbdump-prepare-status').html("")
            $('#div-modal-wizard-cluster-config-finish-db-dump-file-download').hide()
            $('#button-execution-modal-cloud-vm-db-dump').show();
            $('#button-cancel-modal-cloud-vm-db-dump').show();
            $('#button-close-modal-cloud-vm-db-dump').show();
            createLoggerInfo("Creation of mysqldump of ccvm is failed");
            console.log("Creation of mysqldump of ccvm is failed");
            result="500";
        }
    }).catch(function(data){
        $('#div-db-backup').show();
        $('#div-db-backup').text("클라우드센터 가상머신의 데이터베이스 백업이 실패하었습니다.");
        $('#dbdump-prepare-status').html("")
        $('#div-modal-wizard-cluster-config-finish-db-dump-file-download').hide()
        $('#button-execution-modal-cloud-vm-db-dump').show();
        $('#button-cancel-modal-cloud-vm-db-dump').show();
        $('#button-close-modal-cloud-vm-db-dump').show();
        createLoggerInfo("Creation of mysqldump of ccvm is failed");
        console.log("Creation of mysqldump of ccvm is failed");
        result="500";
    });

    // 파이썬 파일 실행 결과에 따라 다운로드 링크 생성
    if (result == "200") {
        await cockpit.file(file_path).read()
        .done(function (tag) {
            $('#span-modal-wizard-cluster-config-finish-db-dump-file-download').attr({
                target: '_blank',
                href: 'data:Application/octet-stream;application/x-xz;attachment;/,' + encodeURIComponent(tag),
                download: "dump_ccvm_cloud_" +date_string+time_string+ ".sql"
            });
            $('#div-db-backup').show();
            $('#div-db-backup').text("클라우드센터 가상머신의 데이터베이스 백업이 완료되었습니다.");
            $('#dbdump-prepare-status').html("")
            $('#div-modal-wizard-cluster-config-finish-db-dump-file-download').show()
            $('#button-execution-modal-cloud-vm-db-dump').show();
            $('#button-cancel-modal-cloud-vm-db-dump').show();
            $('#button-close-modal-cloud-vm-db-dump').show();
            createLoggerInfo("Creation of download link of ccvm_mysqldump is completed");
            console.log("Creation of download link of ccvm_mysqldump is completed");
        }).catch(function(tag){
            $('#div-db-backup').show();
            $('#div-db-backup').text("클라우드센터 가상머신의 데이터베이스 백업이 실패하었습니다.");
            $('#dbdump-prepare-status').html("")
            $('#div-modal-wizard-cluster-config-finish-db-dump-file-download').hide()
            $('#button-execution-modal-cloud-vm-db-dump').show();
            $('#button-cancel-modal-cloud-vm-db-dump').show();
            $('#button-close-modal-cloud-vm-db-dump').show();
            createLoggerInfo("Creation download link of ccvm_mysqldump is failed");
            console.log("Creation download link of ccvm_mysqldump is failed");
        });
        cockpit.file().close()
    }
}

/**
 * Meathod Name : setPfmpStatus
 * Date Created : 2024.09.19
 * Writer  : 정민철
 * Description : 파워플렉스 관리 플랫폼 가상머신 상태 조회
 * Parameter : 없음
 * Return  : 없음
 * History  : 2024.09.19 최초 작성
 */
function setPfmpStatus() {
    cockpit.spawn(['python3',pluginpath + '/python/pfmp/pfmp_status_detail.py', 'detail'])
    .then(function(data) {
        var retVal = JSON.parse(data);
        pfmp_status_result = retVal.val.pfmp_status;
        sessionStorage.setItem('pfmp_status', pfmp_status_result);
    });
}
/**
 * Meathod Name : updateSpinnerPercentage
 * Date Created : 2024.10.25
 * Writer  : 정민철
 * Description : 파워플렉스 관리 플랫폼 설치 퍼센트 조회
 * Parameter : 없음
 * Return  : 없음
 * History  : 2024.09.19 최초 작성
 */
function updateSpinnerPercentage(percentage) {
    document.getElementById('spinner-percentage').innerText = percentage + '%';
}
/**
 * Meathod Name : updatePfmpInstall
 * Date Created : 2024.10.25
 * Writer  : 정민철
 * Description : 파워플렉스 관리 플랫폼 설치 퍼센트 조회
 * Parameter : time_value, unit
 * Return  : 없음
 * History  : 2024.09.19 최초 작성
 */
function updatePfmpInstall(time_value, unit) {
    let currentPercentage = 0;
    let intervalTime;

    if (interval) {
        clearInterval(interval);
    }

    document.getElementById('spinner-percentage').innerText = '0%';

    // 단위를 초 단위로 변환
    if (unit === "minute") {
        intervalTime = (time_value * 60 * 1000) / 100; // 분 -> 밀리초로 변환 후 1%당 시간 계산
    } else if (unit === "second") {
        intervalTime = (time_value * 1000) / 100; // 초 -> 밀리초로 변환 후 1%당 시간 계산
    }

    // 퍼센트 업데이트 실행
    interval = setInterval(() => {
        if (currentPercentage <= 100) {
            updateSpinnerPercentage(currentPercentage);
            currentPercentage += 1; // 1%씩 증가
        } else {
            clearInterval(interval); // 100%가 되면 타이머 종료
        }
    }, intervalTime);
}
function screenConversion(){
    if (os_type == "general-virtualization"){
        $('#div-card-storage-cluster-status').hide();
        $('#div-card-storage-vm-status').hide();
        $('#ccvm-gfs-maintenance-update').show();
        $('#ccvm-gfs-qdevice-init').show();
    }
}