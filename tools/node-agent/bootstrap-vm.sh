#!/bin/sh
# Runs in cloud-init's final stage. Credentials were delivered on this VM's seed ISO.
set -eu
bundle_dir=${1:?Usage: bootstrap-vm.sh /path/to/this-vm-bundle}
config_dir=/etc/ablestack/node-agent

if command -v aspkg >/dev/null 2>&1; then
    aspkg -Uvh --replacepkgs "$bundle_dir/ablecube-agent.rpm"
else
    rpm -Uvh --replacepkgs "$bundle_dir/ablecube-agent.rpm"
fi
install -d -m 0700 "$config_dir"
install -m 0600 "$bundle_dir/install.json" "$config_dir/install.json"
systemctl daemon-reload
systemctl enable cube-agent-setup.service cube-agent-setup.path cube-agent.service

setup_status=0
/usr/libexec/ablestack/node-setup --bundle "$bundle_dir" --restart || setup_status=$?
case "$setup_status" in
    0)
        systemctl is-active --quiet cube-agent.service
        ;;
    75)
        # SCVM sortEth can rename NICs and reboot later in this same cloud-init run.
        # Keep the trusted bundle and policy for the network event/next-boot setup unit.
        systemctl --no-block start cube-agent-setup.service
        printf '%s\n' 'Cube Agent enrollment is waiting for the configured management IP.'
        ;;
    *)
        exit "$setup_status"
        ;;
esac
