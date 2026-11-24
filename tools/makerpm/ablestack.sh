#!/bin/sh
# Copyright (c) 2021 ABLECLOUD Co. Ltd
# RPM 설치 후 실행한다. $1: 최초 설치=1, 업데이트=2 이상.

set -eu

# default/no argument는 기존 수동 실행 방식과 호환한다.
case "${1:-1}" in
    1|default)
        if command -v systemctl >/dev/null 2>&1; then
            if ! systemctl enable --now cockpit.socket; then
                echo "Warning: cockpit.socket could not be enabled; check the service status." >&2
            fi
        fi
        ;;
esac

# 업데이트 중에는 Cockpit을 재시작하지 않아 진행 중인 세션을 유지한다.
exit 0
