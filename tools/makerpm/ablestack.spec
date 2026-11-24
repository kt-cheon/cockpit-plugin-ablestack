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
BuildRequires: /usr/bin/python3
Requires: /bin/bash
Requires: /usr/bin/python3
Requires(pre): /usr/bin/python3
Requires(post): /usr/bin/python3

%description
AbleStack Cockpit Plugin

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
find "$plugin_root/tools/properties" \( -name '*.cube-agent.json*' -o -name '.cube-setup-*' -o -name '.properties-merge-*' \) -exec rm -f -- {} +
# 새 기본값은 일반 payload로 별도 배포한다. 운영 JSON은 키 단위로 병합한다.
rm -rf "$plugin_root/tools/makerpm/property-defaults"
/usr/bin/python3 "$plugin_root/tools/makerpm/properties_config.py" stage-defaults \
    --properties-dir "$plugin_root/tools/properties" \
    --defaults-dir "$plugin_root/tools/makerpm/property-defaults"
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

%post
/usr/bin/python3 /usr/share/cockpit/ablestack/tools/makerpm/properties_config.py merge || exit 1
/bin/sh /usr/share/cockpit/ablestack/tools/makerpm/ablestack.sh "$1"

%pre -p /usr/bin/python3 -f tools/makerpm/properties_config.py

%clean
rm -rf $RPM_BUILD_ROOT

%files -f ablestack-files.list
%defattr(-,root,root,0755)

%changelog
* Tue Dec 10 2025 ABLESTACK <ablecloud@ablecloud.io> - %{version}-%{release}
- Auto build with custom version/release

