import subprocess
import os
from ablestack import *

# 1. multipath -l 명령어로 dm-* 장치 리스트 추출
def get_dm_devices():
    result = subprocess.run(
        "multipath -l | grep mpath | awk '{print $3}'",
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    return set(result.stdout.strip().splitlines())

# /dev/disk/by-id 내부 링크 분류 및 매핑
def map_links_by_dm(dm_devices):
    by_id_path = "/dev/disk/by-id"
    dm_map = {}

    for entry in os.listdir(by_id_path):
        full_path = os.path.join(by_id_path, entry)
        if os.path.islink(full_path):
            target = os.readlink(full_path)
            target_basename = os.path.basename(target)  # ../../dm-2 → dm-2

            if target_basename in dm_devices:
                # 분류
                if target_basename not in dm_map:
                    dm_map[target_basename] = {
                        "multipath_id": [],
                        "multipath_name": [],
                        "scsi": [],
                        "wwn": []
                    }

                if entry.startswith("dm-uuid-mpath"):
                    dm_map[target_basename]["multipath_id"].append("/dev/disk/by-id/" + entry)
                elif entry.startswith("dm-name-mpath"):
                    mpath_name = entry.replace("dm-name-", "")
                    dm_map[target_basename]["multipath_name"].append("/dev/mapper/" + mpath_name)
                elif entry.startswith("scsi-"):
                    dm_map[target_basename]["scsi"].append(entry)
                elif entry.startswith("wwn-"):
                    dm_map[target_basename]["wwn"].append(entry)

    # dm-* 이름을 숫자 기준으로 정렬
    sorted_dm_map = dict(
        sorted(dm_map.items(), key=lambda x: int(x[0].split('-')[1]))
    )
    return sorted_dm_map

# 메인 로직
def result():
    try:
        dm_devices = get_dm_devices()
        mapped = map_links_by_dm(dm_devices)
        return createReturn(code=200, val=mapped)
    except Exception as e:
        return createReturn(code=500, val=str(e))

if __name__ == "__main__":
    print(result())
