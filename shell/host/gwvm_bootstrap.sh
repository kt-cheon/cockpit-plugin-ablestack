#!/usr/bin/env bash
#########################################
#Copyright (c) 2021 ABLECLOUD Co. Ltd.
#
#ccvm 초기화(bootstrap)하는 스크립트
#
#최초작성자 : 배태주
#최초작성일 : 2023-05-19
#########################################
set -x
set -o pipefail
LOGFILE="/var/log/gwvm_install.log"

# hosts=$(grep -v mngt /etc/hosts | grep -v scvm | grep -v pn | grep -v localhost | awk {'print $1'})

################# firewall setting
allow_gateway_firewall() {
    firewall-cmd --zone=public "$@" 2>&1 | tee -a "$LOGFILE" || return 1
    firewall-cmd --permanent --zone=public "$@" 2>&1 | tee -a "$LOGFILE" || return 1
}
allow_gateway_firewall --add-port=9100/tcp || exit 1
allow_gateway_firewall --add-port=9095/tcp || exit 1
allow_gateway_firewall --add-port=5050/tcp || exit 1
allow_gateway_firewall --add-port=3260/tcp || exit 1
allow_gateway_firewall --add-service=ceph || exit 1
allow_gateway_firewall --add-service=ceph-mon || exit 1
allow_gateway_firewall --add-service=iscsi-target || exit 1
firewall-cmd --list-all 2>&1 | tee -a $LOGFILE

#ceph 키 복사
/usr/libexec/ablestack/node-copy -q -o StrictHostKeyChecking=no root@scvm-mngt:/etc/ceph/* /etc/ceph/

# hostname=$(hostname)
# ip=$(hostname -i)

# ceph orch host add $hostname $ip

# Delete bootstrap script file
rm -rf /root/bootstrap.sh
