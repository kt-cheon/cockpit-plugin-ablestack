# Diplo RPM 빌드와 설정 보존

이 브랜치는 `ablecube` 단일 RPM을 빌드합니다.

```sh
bash tools/makerpm/rpmbuild.sh <Version> <Release>
bash tools/makerpm/rpmbuild.sh <Version> <Release> /path/to/source --source-only
```

Linux 빌드 서버에 `rpm-build`와 Python 3가 필요합니다. 소스 내 `node_modules`도
준비합니다. 기본 빌드 경로는 스크립트가 위치한 저장소입니다. 산출물은 `rpmbuild/`
아래에 생성하며 `ABLESTACK_RPM_TOPDIR`로 변경할 수 있습니다. 운영 키, VM 작업 파일,
`.rpmnew` 등 설정 백업과 생성된 기본값 폴더는 소스에서 제외합니다.
빌드마다 새로운 임시 경로를 사용합니다.

## 설정 파일 처리

설치 경로 `/usr/share/cockpit/ablestack/tools/properties/` 아래의 패키지 기본 설정 파일은
`%config(noreplace)`로 등록됩니다. `cluster.json`, `ablestack.json`,
`glue_conf.json`, `pfmp_config.json` 및 이후 추가하는 설정 파일에 적용됩니다.
애플리케이션에서 사용하는 경로는 동일합니다.

RPM 업데이트는 **기존 JSON 값을 우선하고 새 버전에 추가된 키만 채우는 재귀 병합**을
수행합니다. 파일 전체를 이전 내용으로 되돌리는 방식이 아닙니다.

1. RPM의 설치 전 단계에서 기존 JSON 값과 파일 권한·소유자를 읽습니다.
   이 코드는 RPM 자체에 포함하므로 이전 버전에 병합 도구가 없어도 동작합니다.
2. 빌드 시 검증한 새 기본값은 `tools/makerpm/property-defaults/`에 일반 파일로
   별도 배포합니다. `.rpmnew`의 생성 여부나 이전 버전 파일에 의존하지 않습니다.
3. 설치 후 `properties_config.py merge`가 새 기본값에 기존 값을 재귀적으로 병합합니다.
   같은 디렉터리의 임시 파일을 원자적으로 교체하고 기존 권한·소유자를 유지합니다.

예를 들어 기존 설정이 다음과 같고,

```json
{"bootstrap": {"scvm": true}, "ui": {"enabled": false}}
```

새 RPM의 기본 설정이 다음과 같다면,

```json
{"bootstrap": {"scvm": false, "new_step": false}, "ui": {"enabled": true, "new_tab": true}}
```

업데이트 결과는 다음과 같습니다.

```json
{"bootstrap": {"scvm": true, "new_step": false}, "ui": {"enabled": false, "new_tab": true}}
```

중첩 객체도 같은 규칙을 적용합니다. `false`, `0`, 빈 문자열, `null`, 빈 배열을
유효한 기존 값으로 유지합니다. 호스트 목록 등의 배열은 전체 값을 유지하며
인덱스별로 샘플 항목을 합치지 않습니다. 사용자가 추가한 키와 새 기본값에서 제거된
기존 키도 유지합니다. 값의 자료형이 바뀌어도 기존 값을 우선하므로 자료형 변경에
따른 변환이 필요하면 별도 마이그레이션으로 처리합니다.

운영 중 생성하는 `<hostname>.cube-agent.json`도 같은 디렉터리에 보관하지만,
개인키가 포함되므로 root 소유 `0600`으로 저장합니다. 이 파일과 쓰기 중의
`.cube-setup-*` 임시 파일, 등록 JSON의 백업 파일은 소스 아카이브와 RPM payload에서 제외합니다.
RPM이 소유하지 않는 운영 파일이므로 업그레이드에서도 내용과 권한이 유지됩니다.
공통 `cluster.json`에는 개인키를 추가하지 않습니다.

| 상황 | RPM 업데이트 결과 |
| --- | --- |
| 운영 중 변경한 설정 | 기존 값을 유지하고 새 키만 추가 |
| 변경한 설정과 새 패키지 기본값이 모두 달라짐 | 기존 값과 새 키를 병합, RPM이 만든 `.rpmnew`는 별도 유지 |
| 설치 후 변경하지 않은 기본 설정 | 기존 값도 유지하고 새 키만 추가 |
| 새로 추가되었거나 현재 없는 설정 파일 | 패키지의 기본값으로 설치 |
| 코드, 화면, 배포 템플릿 | 새 버전으로 업데이트 |

기존 RPM이 설정 파일을 일반 파일로 등록했더라도 설치 전 읽은 값을 사용하므로
업데이트 도중 파일이 새 기본값으로 교체되어도 기존 값과 새 키를 병합합니다.
이미 이전 업데이트에서 사라진 값은 이 변경으로 복구되지 않습니다.

기존 JSON이 잘못되었거나 중복 키가 있으면 해당 패키지 설치 전에 오류로 중단합니다.
새 기본 JSON도 빌드 시 검사합니다. 병합 중 오류가 나면 실패를 반환하고
`/var/lib/ablestack/properties-upgrade/pending.json`에 읽어 둔 값을 보존합니다.
디렉터리는 `0700`, 상태 파일은 `0600`이며 설정값을 로그에 출력하지 않습니다.
미완료 상태를 새 작업으로 덮어쓰지 않습니다. 새 RPM 파일 설치 후 병합이 실패했다면
원인을 해결하고 다음 명령으로 병합을 완료한 뒤 업데이트를 다시 진행합니다.

```sh
python3 /usr/share/cockpit/ablestack/tools/makerpm/properties_config.py merge
```

병합 성공 후 임시 상태 파일은 삭제합니다. `.rpmnew` 파일 전체를 운영 JSON에 복사하면
기존 값이 사라질 수 있으므로 병합을 대체하는 용도로 사용하지 않습니다.

`rpm -e`로 삭제한 다음 새로 설치하는 방식과 소스 디렉터리의 `cp -r` 복사는
RPM 업그레이드와 동작이 다릅니다. 설정을 보존하는 업데이트에는 `rpm -Uvh`
또는 패키지 관리자의 업그레이드 기능을 사용합니다.

## 검증

```sh
python3 -B -m unittest discover -s tests -p 'test_properties_config.py' -v
python3 -B -m unittest discover -s tests -p 'test_rpm_packaging.py' -v
```

모의 소스와 임시 디렉터리에서 검사하며 실제 RPM을 설치하지 않습니다.
업데이트 시 Cockpit을 강제 재시작하거나 디렉터리 권한을 일괄 변경하지 않습니다.
