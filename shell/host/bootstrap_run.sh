#!/usr/bin/env bash
#########################################
#Copyright (c) 2021 ABLECLOUD Co. Ltd.
#
#센터 구성 실행: SCVM은 점보 프레임 검사 후 실행하며 진행 단계를 출력합니다.
#SCVM/CCVM의 구성 완료 상태는 실제 스크립트가 성공한 후 저장합니다.
#최초작성자 : 최진성 책임
#최초작성일 : 2021-04-05
#########################################

if [ "$1" = "scvm" ] || [ "$1" = "ccvm" ]
then
  bootstrap_plugin_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd) || exit 1
  exec python3 "$bootstrap_plugin_root/python/bootstrap/center_bootstrap.py" "$@"

elif [ "$1" = "wall" ]
then
  hosts=$(grep ablecube /etc/hosts |grep -v pn |  awk '{print $1}')
  for host in $hosts
  do
    /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host python3 /usr/share/cockpit/ablestack/python/ablestack_json/ablestackJson.py update --depth1 monitoring --depth2 wall --value true
  done

else
  echo '지원하지 않는 구성 작업입니다.' >&2
  exit 1
fi
