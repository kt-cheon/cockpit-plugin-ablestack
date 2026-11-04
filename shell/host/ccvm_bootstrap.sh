#!/usr/bin/env bash
#########################################
#Copyright (c) 2026 ABLECLOUD Co. Ltd.
#
#클라우드센터 구성 스크립트
#########################################

set -Ee
set -o pipefail
LOGFILE="/var/log/cloud_install.log"
bootstrap_stage='클라우드센터 구성을 준비합니다.'
progress() {
  bootstrap_stage="$*"
  printf '[ABLESTACK-PROGRESS] %s\n' "$bootstrap_stage"
}
trap 'code=$?; printf "[ABLESTACK-PROGRESS] 오류: %s (종료 코드 %s)\n" "$bootstrap_stage" "$code"; exit "$code"' ERR
cluster_host_lines() {
  awk '{sub(/#.*/, "")} NF >= 2 {print}' /etc/hosts
}
os_type=$(cat /etc/cluster.json | grep '"type"' | awk -F'"' '{print $4}')
hosts=$(cluster_host_lines | grep -v mngt | grep -v scvm | grep -v pn | grep -v localhost | awk '!seen[$1]++ {print $1}')

progress '데이터베이스 서비스를 시작하고 방화벽을 설정합니다.'
systemctl enable --now mysqld
DATABASE_PASSWD="Ablecloud1!"
################# firewall setting

firewall-cmd --zone=public --add-service=mysql 2>&1 | tee -a "$LOGFILE" || exit 1
firewall-cmd --permanent --zone=public --add-service=mysql 2>&1 | tee -a "$LOGFILE" || exit 1
firewall-cmd --list-all 2>&1 | tee -a $LOGFILE

# 라이선스 종류에 따라 설정 $1="hv" or "ablestack" or "clostack"
progress '라이선스에 맞는 클라우드센터 화면을 설정합니다.'
sh /usr/share/cloudstack-common/scripts/util/update-mold-theme-from-license.sh "$1"

# setCrushmap
if [ "${os_type}" = "ablestack-hci" ]; then
  # /etc/hosts에서 SCVM 관리 IP를 한 개만 가져옵니다.
  scvm="$(
    awk '$0 !~ /^[[:space:]]*#/ && $0 ~ /scvm-mngt/ {
      print $1
      exit
    }' /etc/hosts
  )"

  if [ -z "${scvm}" ]; then
    echo "[ERROR] /etc/hosts에서 scvm-mngt 주소를 찾을 수 없습니다."
    exit 1
  fi

  progress "${scvm}에서 스토리지 CRUSH map을 설정합니다."

  /usr/libexec/ablestack/node-remote \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=no \
    "root@${scvm}" \
    "/usr/local/sbin/setCrushmap.sh"

  if [ "$?" -ne 0 ]; then
    echo "[ERROR] SCVM의 CRUSH map 설정에 실패했습니다."
    exit 1
  fi
fi

# resize partition
progress '디스크 용량을 확장하고 NFS 스토리지를 구성합니다.'
sgdisk -e /dev/vda
parted --script /dev/vda resizepart 3 100%
pvresize /dev/vda3
lvcreate rl -n nfs --extents 100%FREE
mkfs.xfs /dev/rl/nfs
mkdir -p /nfs
echo  '/dev/mapper/rl-nfs /nfs                    xfs    defaults        0 0' >> /etc/fstab
echo '/nfs *(rw,no_root_squash,async)' >> /etc/exports
systemctl enable --now nfs-server.service

mkdir -p /nfs/primary
mkdir -p /nfs/secondary


# 데이터베이스 초기화 및 구성
progress '클라우드센터 데이터베이스를 초기화합니다.'
mysqladmin -uroot password $DATABASE_PASSWD
cloudstack-setup-databases cloud:$DATABASE_PASSWD --deploy-as=root:$DATABASE_PASSWD  2>&1 | tee -a $LOGFILE

# 글로벌설정 DB 업데이트
progress '클라우드센터 기본 정책을 적용합니다.'
global_settings=(
  "enable.vm.network.filter.allow.all.traffic=true"
)

for i in "${global_settings[@]}"; do
  IFS='=' read -r key value <<< "$i"

  if [[ -n "$key" && -n "$value" ]]; then
    mysql --user=root --password="$DATABASE_PASSWD" -e \
      "USE cloud; UPDATE configuration SET value='$value' WHERE name='$key';" \
      2>/dev/null | tee -a "$LOGFILE"
  else
    echo "잘못된 설정 항목: $i" | tee -a "$LOGFILE"
  fi
done

# Management 암호화 키 파일 권한 보정
KEY_FILE="/etc/cloudstack/management/key"

if [[ -f "$KEY_FILE" ]]; then
    chown root:cloud "$KEY_FILE"
    chmod 640 "$KEY_FILE"
fi

progress '클라우드 관리 서버를 구성하고 서비스를 시작합니다.'
cloudstack-setup-management  2>&1 | tee -a $LOGFILE

systemctl enable --now mold.service

# Mold 심볼릭 링크 적요
bash /usr/share/cockpit/ablestack/shell/host/mold-alias-links.sh
rm -f /usr/share/cockpit/ablestack/shell/host/mold-alias-links.sh

#UEFI 설정 파일 생성
#echo -e "guest.nvram.template.secure=/usr/share/edk2/ovmf/OVMF_VARS.secboot.fd
#guest.nvram.template.legacy=/usr/share/edk2/ovmf/OVMF_VARS.fd
#guest.loader.secure=/usr/share/edk2/ovmf/OVMF_CODE.secboot.fd
#guest.loader.legacy=/usr/share/edk2/ovmf/OVMF_CODE.secboot.fd
#guest.nvram.path=/var/lib/libvirt/qemu/nvram/" > /root/uefi.properties

#for host in $hosts
#do
#  /usr/libexec/ablestack/node-copy -o StrictHostKeyChecking=no /root/uefi.properties $host:/etc/cloudstack/agent/
#done

#rm -rf /root/uefi.properties


#tpm 설정 파일 생성
progress '각 호스트에 가상머신 TPM 설정을 전달합니다.'
echo -e "host.tpm.enable=true" > /root/tpm.properties

for host in $hosts
do
  /usr/libexec/ablestack/node-copy -o StrictHostKeyChecking=no /root/tpm.properties $host:/etc/cloudstack/agent/
done

rm -rf /root/tpm.properties

#systemvm template 등록
progress '시스템 가상머신 템플릿을 등록합니다. 잠시 기다려 주십시오.'
/usr/share/cloudstack-common/scripts/storage/secondary/cloud-install-sys-tmplt \
-m /nfs/secondary \
-f /usr/share/ablestack/systemvmtemplate-* \
-h kvm -F

if [ "${os_type}" != "ablestack-standalone" ]
then
  progress '호스트의 고가용성 클러스터 서비스를 시작합니다.'
  for host in $hosts
  do
    /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host /usr/bin/systemctl enable --now pacemaker
    /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host /usr/bin/systemctl enable --now corosync
  done
fi

# 06시 Mold 서비스 재시작 스크립트 등록
#(crontab -l 2>/dev/null; echo "0 6 * * * /usr/bin/systemctl restart mold.service") | crontab -

# ccvm 로그 정리 스크립트 등록
progress '로그 정리와 데이터베이스 백업 일정을 등록합니다.'
(crontab -l 2>/dev/null || true; echo "0 0 * * 7 /usr/local/sbin/ccvm_log_maintainer.sh") | crontab -

# ccvm mold db 백업
(crontab -l 2>/dev/null || true; echo "0 1 * * * /usr/bin/python3 /usr/share/ablestack/backup_mysql.py") | crontab -

# mold-usage 서비스 시작
systemctl enable --now mold-usage.service

# Delete bootstrap script file
rm -rf /root/bootstrap.sh
progress '클라우드센터 내부 구성이 완료되었습니다.'

