#네트워크 장치 정보 조회 기능 개발
네트워크 장치의 정보를 조회하기 위한 기능입니다.

##사용법
```shell
# python3 python/nic/network_action.py list [-H]
-H 옵션: 줄바꿈이 된 사람이 읽기 편한 json으로 출력
```

##출력
Ethernet NIC의 `STATE`는 `LC_ALL=C /usr/sbin/ethtool <인터페이스>`의 `Link detected`로 판단합니다.
`yes`이면 `connected`, `no`이면 `disconnected`, 조회 실패 또는 결과가 없으면 `unknown`입니다.
브릿지와 기타 인터페이스의 `STATE`는 기존처럼 NetworkManager 상태를 사용합니다.

```json
{
  "code": 200,
  "val": {
    "bridges": [
      "block device(disk) 정보"
    ],
    "ethernets": [
      "raid contoller 정보"
    ],
    "others": [
      "기타 네트워크 인터페이스(lo, wifi등, vnet등) 정보"
    ]
  },,
  "name": "listNetworkInterface",
  "type": "dict"
}
```

##출력 예시
```json
{
  "code": 200,
  "val": {
    "bridges": [
      {
        "DEVICE": "bridge0",
        "TYPE": "bridge",
        "STATE": "connected"
      },
      {
        "DEVICE": "cloud0",
        "TYPE": "bridge",
        "STATE": "connected"
      }
    ],
    "ethernets": [
      {
        "DEVICE": "enp3s0",
        "TYPE": "ethernet",
        "STATE": "connected",
        "PCI": "0000:03:00.0"
      }
    ],
    "others": [
      {
        "DEVICE": "wlp2s0",
        "TYPE": "wifi",
        "STATE": "connected"
      },
      {
        "DEVICE": "vnet0",
        "TYPE": "tun",
        "STATE": "connected"
      },
      {
        "DEVICE": "vnet1",
        "TYPE": "tun",
        "STATE": "connected"
      },
      {
        "DEVICE": "vnet2",
        "TYPE": "tun",
        "STATE": "connected"
      },
      {
        "DEVICE": "lo",
        "TYPE": "loopback",
        "STATE": "unmanaged"
      }
    ]
  },
  "name": "listNetworkInterface",
  "type": "dict"
}
```
