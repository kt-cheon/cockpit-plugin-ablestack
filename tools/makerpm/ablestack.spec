Name: ablecube
Version: %{version}
Release: %{release}
Source0: %{name}-%{version}.tar.gz
Summary: ablestack cockpit plugin

Group: ABLECLOUD
License: None
URL: https://github.com/ablecloud-team/ablestack-cockpit-plugin.git
BuildRoot: %(mktemp -ud %{_tmppath}/%{name}-%{version}-%{release}-XXXXXX)

BuildRequires: /bin/bash
Requires: /bin/bash
Requires: ablecube-agent = %{version}-%{release}

%description
AbleStack Cockpit Plugin

%package agent
Summary: ABLESTACK authenticated node management transport
BuildArch: noarch
Requires: /usr/bin/python3
Requires: python3 >= 3.9
Requires: /bin/sh
Requires: /usr/bin/openssl
Requires: /usr/sbin/ip
# 기존 패키지 이름으로 설치한 환경의 RPM 교체 및 의존성 호환.
Provides: ablecube-node-agent = %{version}-%{release}
Obsoletes: ablecube-node-agent <= %{version}-%{release}

%description agent
Mutually authenticated HTTPS transport for ABLESTACK hosts and management VMs.

%define debug_package %{nil}
%define _unpackaged_files_terminate_build 1
%define _missing_doc_files_terminate_build 0

%prep
%setup -q

%build

%install
rm -rf "$RPM_BUILD_ROOT"
mkdir -p "$RPM_BUILD_ROOT/usr/share/cockpit/ablestack"

cp -a {README.md,node_modules,images,main.html,manifest.json,sample,shell,src,tools,python,index.html,index.js,main-glue.html,main-glue-no-permission.html} \
    "$RPM_BUILD_ROOT/usr/share/cockpit/ablestack"

# 디렉터리에는 탐색 권한을 주고, 설정 파일은 실행 파일로 설치하지 않는다.
plugin_root="$RPM_BUILD_ROOT/usr/share/cockpit/ablestack"
# 등록 JSON은 운영 중 생성한 개인키이므로 빌드 결과에 포함하지 않는다.
find "$plugin_root/tools/properties" \( -name '*.cube-agent.json*' -o -name '.cube-setup-*' \) -exec rm -f -- {} +
find "$plugin_root" -type d -exec chmod 0755 {} +
find "$plugin_root/tools/properties" -type f -exec chmod 0644 {} +

# 디렉터리/설정/코드를 구분해 파일마다 한 번씩만 목록에 기록한다.
# 실행 권한은 파일 속성으로 지정해 빌드 후처리의 shebang 검사와 분리한다.
find "$plugin_root" -print | LC_ALL=C sort | while IFS= read -r file; do
    path=${file#"$RPM_BUILD_ROOT"}
    escaped_path=$(printf '%%s\n' "$path" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%%/%%%%/g')
    if [ -d "$file" ] && [ ! -L "$file" ]; then
        printf '%%s "%%s"\n' '%%dir' "$escaped_path"
    else
        case "$path" in
            /usr/share/cockpit/ablestack/tools/properties/*)
                printf '%%s "%%s"\n' '%%config(noreplace)' "$escaped_path"
                ;;
            /usr/share/cockpit/ablestack/shell/*.sh|/usr/share/cockpit/ablestack/python/*.py|/usr/share/cockpit/ablestack/tools/*.sh|/usr/share/cockpit/ablestack/tools/*.py|/usr/share/cockpit/ablestack/shell/host/ipcorrector)
                printf '%%s "%%s"\n' '%%attr(0755,root,root)' "$escaped_path"
                ;;
            *)
                printf '"%%s"\n' "$escaped_path"
                ;;
        esac
    fi
done > ablestack-files.list

install -d "$RPM_BUILD_ROOT/usr/libexec/ablestack/node-agent"
install -m 0644 tools/node-agent/*.py tools/node-agent/agent.json tools/node-agent/install-bundle.sh \
    tools/node-agent/bootstrap-vm.sh \
    "$RPM_BUILD_ROOT/usr/libexec/ablestack/node-agent/"
install -m 0755 tools/node-agent/node-remote tools/node-agent/node-copy tools/node-agent/node-setup \
    "$RPM_BUILD_ROOT/usr/libexec/ablestack/"
install -d -m 0700 "$RPM_BUILD_ROOT/etc/ablestack/node-agent"
install -m 0600 tools/node-agent/agent.json "$RPM_BUILD_ROOT/etc/ablestack/node-agent/agent.json"
install -m 0600 tools/node-agent/install.json "$RPM_BUILD_ROOT/etc/ablestack/node-agent/install.json"
install -d -m 0700 "$RPM_BUILD_ROOT/var/lib/ablestack/cube-agent" \
    "$RPM_BUILD_ROOT/var/lib/ablestack/cube-agent/bundles" \
    "$RPM_BUILD_ROOT/var/lib/ablestack/cube-agent/enrollment"
install -d "$RPM_BUILD_ROOT/usr/lib/systemd/system"
install -m 0644 tools/node-agent/cube-agent.service tools/node-agent/cube-agent-setup.service \
    tools/node-agent/cube-agent-setup.path \
    "$RPM_BUILD_ROOT/usr/lib/systemd/system/"
install -d "$RPM_BUILD_ROOT/etc/NetworkManager/dispatcher.d"
install -m 0755 tools/node-agent/90-cube-agent-setup "$RPM_BUILD_ROOT/etc/NetworkManager/dispatcher.d/"

%post
/bin/sh /usr/share/cockpit/ablestack/tools/makerpm/ablestack.sh "$1"

%post agent
if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || :
    if [ "$1" -eq 1 ]; then
        systemctl enable cube-agent-setup.service cube-agent-setup.path cube-agent.service >/dev/null 2>&1 || :
        if [ -d /run/systemd/system ]; then
            systemctl --no-block start cube-agent-setup.path cube-agent-setup.service >/dev/null 2>&1 || :
        fi
    fi
fi

%preun agent
if [ "$1" -eq 0 ] && command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now cube-agent-setup.path cube-agent-setup.service cube-agent.service >/dev/null 2>&1 || :
fi

%postun agent
if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || :
fi

%clean
rm -rf "$RPM_BUILD_ROOT"

%files -f ablestack-files.list
%defattr(-,root,root,0755)

%files agent
%defattr(-,root,root,0755)
%dir /usr/libexec/ablestack
/usr/libexec/ablestack/node-agent
%attr(0755,root,root) /usr/libexec/ablestack/node-remote
%attr(0755,root,root) /usr/libexec/ablestack/node-copy
%attr(0755,root,root) /usr/libexec/ablestack/node-setup
%dir /etc/ablestack
%attr(0700,root,root) %dir /etc/ablestack/node-agent
%attr(0600,root,root) %config(noreplace) /etc/ablestack/node-agent/agent.json
%attr(0600,root,root) %config(noreplace) /etc/ablestack/node-agent/install.json
%dir /var/lib/ablestack
%attr(0700,root,root) %dir /var/lib/ablestack/cube-agent
%attr(0700,root,root) %dir /var/lib/ablestack/cube-agent/bundles
%attr(0700,root,root) %dir /var/lib/ablestack/cube-agent/enrollment
/usr/lib/systemd/system/cube-agent.service
/usr/lib/systemd/system/cube-agent-setup.service
/usr/lib/systemd/system/cube-agent-setup.path
%dir /etc/NetworkManager/dispatcher.d
%attr(0755,root,root) /etc/NetworkManager/dispatcher.d/90-cube-agent-setup

%changelog
* Wed Dec 10 2025 ABLESTACK <ablecloud@ablecloud.io> - %{version}-%{release}
- Auto build with custom version/release

