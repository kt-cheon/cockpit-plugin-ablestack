#!/usr/bin/env bash
#########################################
#Copyright (c) 2021 ABLECLOUD Co. Ltd.
#########################################
set -Ee -o pipefail
bootstrap_stage='스토리지센터 구성을 준비합니다.'
progress() {
  bootstrap_stage="$*"
  printf '[ABLESTACK-PROGRESS] %s\n' "$bootstrap_stage"
}
trap 'code=$?; printf "[ABLESTACK-PROGRESS] 오류: %s (종료 코드 %s)\n" "$bootstrap_stage" "$code"; exit "$code"' ERR
cluster_host_lines() {
  awk '{sub(/#.*/, "")} NF >= 2 {print}' /etc/hosts
}
progress 'Ceph 클러스터 설정 파일을 생성합니다.'
#scvm의 PN-ip를 갖는 host목록 생성
conffile=/root/ceph.conf
imagename="localhost:15000/glue/daemon:Europa"
hosts=$(cluster_host_lines | grep scvm | grep -v mngt | grep -v cn | awk '!seen[$1]++ {print $1}')
scvms=$hosts
allhosts=$(cluster_host_lines | grep -v mngt | grep -v cn | grep -v localhost | awk '!seen[$1]++ {print $1}')

echo "[global]" > "$conffile"
echo -n -e "\tmon_host = " >> "$conffile"
for host in $hosts
do
  echo -n "[v2:$host:3300/0,v1:$host:6789/0], " >> "$conffile"
done
echo >> "$conffile"
echo -n -e "\tmon host = " >> "$conffile"
for host in $hosts
do
  echo -n "[v2:$host:3300/0,v1:$host:6789/0], " >> "$conffile"
done
echo  >> "$conffile"
echo -e "\tcontainer_image = $imagename" >> "$conffile"
echo -e "\tmgr/cephadm/container_image_base = $imagename" >> "$conffile"
echo >> "$conffile"
sed -i 's/, $//' "$conffile"

# podman registry container start
progress '컨테이너 이미지 저장소를 시작합니다.'
podman start registry

#container image id추출
image=$(/bin/podman inspect --format {{.ID}},{{.RepoDigests}} $imagename | cut -d "," -f 2 | sed 's/\[//' | sed 's/]//' )
progress 'Ceph 클러스터를 초기화합니다. 모니터·관리자·대시보드 서비스를 배포합니다.'
cephadm --image "$image" bootstrap \
        --initial-dashboard-user admin \
        --initial-dashboard-password password \
        --ssh-private-key /root/.ssh/id_rsa \
        --ssh-public-key /root/.ssh/id_rsa.pub \
        --no-minimize-config \
        --skip-pull \
        --allow-overwrite \
        --mon-ip "$(cluster_host_lines | awk '{for (i=2; i<=NF; i++) if ($i == "scvm") {print $1; exit}}')" \
        --cluster-network "$(cluster_host_lines | awk '{for (i=2; i<=NF; i++) if ($i == "cn-scvm") {print $1; exit}}' | cut -d '.' -f 1-3).0/24" \
        --config "$conffile"
progress '스토리지 성능 및 모니터링 컨테이너 설정을 적용합니다.'
        ceph config set global container_image $image
        ceph config set global mgr/cephadm/container_image_base $image
        ceph config set client rbd_cache_policy writeback
        ceph config set client rbd_cache_size 4294967296
        ceph config set client rbd_cache_max_dirty 3221225472
        ceph config set client rbd_cache_target_dirty 2147483648
        ceph config set client rbd_cache_max_dirty_age 5.0
        ceph config set osd bluefs_sync_write true
        ceph config set osd bluefs_buffered_io true
        ceph config set osd bluestore_prefer_deferred_size 0
        ceph config set osd bluestore_prefer_deferred_size_ssd 65536
        ceph config set osd bluestore_deferred_batch_ops 0
        ceph config set osd bluestore_deferred_batch_ops_ssd 16
        ceph config set osd osd_memory_target 2684354560
        ceph config set osd osd_memory_target_autotune false
        ceph config set osd bluestore_throttle_bytes 67108864
        ceph config set osd bluestore_throttle_deferred_bytes 134217728
        ceph config set osd osd_client_message_cap 256
        ceph config set osd bluestore_sync_submit_transaction false
        ceph config set osd ms_dispatch_throttle_bytes 104857600
        ceph config set osd bluestore_cache_autotune true
        ceph config set osd osd_memory_base 805306368
        ceph config set osd osd_memory_cache_min 134217728
        ceph config set mgr mgr/cephadm/container_image_alertmanager localhost:15000/prom/alertmanager:Europa
        ceph config set mgr mgr/cephadm/container_image_grafana localhost:15000/grafana/grafana:Europa
        ceph config set mgr mgr/cephadm/container_image_node_exporter localhost:15000/prom/node-exporter:Europa
        ceph config set mgr mgr/cephadm/container_image_prometheus localhost:15000/prom/prometheus:Europa
        ceph config set mgr mgr/cephadm/container_image_loki localhost:15000/grafana/loki:Europa
        ceph config set mgr mgr/cephadm/container_image_promtail localhost:15000/grafana/promtail:Europa
        ceph config set mgr mgr/cephadm/container_image_nvmeof-cli localhost:15000/glue/nvmeof-cli:Europa
        ceph config set mgr mgr/cephadm/container_image_nvmeof localhost:15000/glue/nvmeof:Europa
        ceph config set mgr mgr/cephadm/container_image_keepalived localhost:15000/glue/keepalived:2.2.4
        ceph config set mgr mgr/cephadm/container_image_haproxy localhost:15000/glue/haproxy:2.3


#crontab<<EOF
#* * * * * /usr/local/bin/ipcorrector
#EOF
#sed -e '/mon host/d' /etc/ceph/ceph.conf | sed -e 's/mon_host/mon host/' > /etc/ceph/ceph.conf_
progress 'Ceph 설정 파일과 인증 정보를 클러스터 노드에 전달합니다.'
grep fsid /etc/ceph/ceph.conf >> /root/ceph.conf
sed -e '/mon_host/d' /root/ceph.conf > /etc/ceph/ceph.conf_
cp /etc/ceph/ceph.conf_ /etc/ceph/ceph.conf
for host in $allhosts
do
  /usr/libexec/ablestack/node-copy -o StrictHostKeyChecking=no /etc/ceph/* $host:/etc/ceph/
done
for host in $hosts
do
  /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host rm -rf /root/bootstrap.sh
done

for host in $scvms
do
  /usr/libexec/ablestack/node-remote $host "(crontab -l 2>/dev/null; echo \"* * * * * /usr/local/bin/ipcorrector\") | crontab -"
done

progress 'Ceph 모니터를 배치하고 스토리지 호스트를 등록합니다.'
ceph orch apply mon --placement=3

for host in $scvms
do
  progress "스토리지 호스트를 등록합니다: $host"
  ceph orch host add "$(cluster_host_lines | awk -v address="$host" '$1 == address {print $2; exit}')" "$host"
done

progress '스토리지 대시보드의 관리 주소와 접근 설정을 적용합니다.'
for mgr in $(ceph orch ps |grep mgr |awk {'print $1'} | sed 's/mgr\.//')
do
  scvm=$(echo $mgr | sed 's/\..*//')
  ip=$(cluster_host_lines | awk -v name="$scvm-mngt" '{for (i=2; i<=NF; i++) if ($i == name) {print $1; exit}}')
  ceph config set mgr mgr/dashboard/$mgr/server_addr $ip
done

ceph mgr module disable dashboard
ceph mgr module enable dashboard

ceph config set mon mon_warn_on_insecure_global_id_reclaim_allowed false

progress '모니터링 및 스토리지 API 서비스를 시작합니다.'
for host in $hosts
do
  /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host /usr/bin/mv -f /usr/share/ablestack/ablestack-wall/process-exporter/scvm_process.yml /usr/share/ablestack/ablestack-wall/process-exporter/process.yml
  /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host systemctl enable --now node-exporter
  /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host systemctl enable --now process-exporter
  /usr/libexec/ablestack/node-remote -o StrictHostKeyChecking=no $host systemctl enable --now glue-api.service
done

progress '스토리지센터 내부 구성이 완료되었습니다.'
exit
