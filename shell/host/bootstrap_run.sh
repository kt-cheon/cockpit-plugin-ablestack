#!/usr/bin/env bash
#########################################
#Copyright (c) 2021 ABLECLOUD Co. Ltd.
#
#scvm의 /root/bootstrap.sh을 실행하기 전 중복 실행을 방지 하기위해
#각 host에 /usr/share/cockpit/bootstrap_run_check파일을 생성하여 실행 여부를 확인함.
# 이후 /root/bootstrap.sh파일 실행
#최초작성자 : 최진성 책임
#최초작성일 : 2021-04-05
#########################################

if [ $1 = "scvm" ]
then
  hosts=$(grep ablecube /etc/hosts |grep -v pn |  awk '{print $1}')
  for host in $hosts
  do
    /usr/bin/ssh -o StrictHostKeyChecking=no $host python3 /usr/share/cockpit/ablestack/python/ablestack_json/ablestackJson.py update --depth1 bootstrap --depth2 scvm --value true
  done

  /usr/bin/ssh -o StrictHostKeyChecking=no scvm sh /root/bootstrap.sh > /var/log/scvm_bootstrap.log

elif [ $1 = "wall" ]
then
  hosts=$(grep ablecube /etc/hosts |grep -v pn |  awk '{print $1}')
  for host in $hosts
  do
    /usr/bin/ssh -o StrictHostKeyChecking=no $host python3 /usr/share/cockpit/ablestack/python/ablestack_json/ablestackJson.py update --depth1 monitoring --depth2 wall --value true
  done

else
  hosts=$(grep ablecube /etc/hosts |grep -v pn |  awk '{print $1}')
  for host in $hosts
  do
    /usr/bin/ssh -o StrictHostKeyChecking=no $host python3 /usr/share/cockpit/ablestack/python/ablestack_json/ablestackJson.py update --depth1 bootstrap --depth2 ccvm --value true
  done
  /usr/bin/ssh -o StrictHostKeyChecking=no ccvm sh /root/bootstrap.sh
fi