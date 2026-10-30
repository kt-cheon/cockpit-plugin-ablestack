#!/bin/sh
# Run on the intended node's console or through an already authenticated management channel.
set -eu
bundle_dir=${1:?Usage: install-bundle.sh /path/to/this-node-bundle}
if [ "$(id -u)" -ne 0 ]; then
    echo "Run this installer with sudo." >&2
    exit 1
fi
for bundle_file in agent.json ca.crt node.crt node.key; do
    test -f "$bundle_dir/$bundle_file"
done
if [ -f "$bundle_dir/ablecube-agent.rpm" ]; then
    if command -v aspkg >/dev/null 2>&1; then
        aspkg -Uvh --replacepkgs "$bundle_dir/ablecube-agent.rpm"
    else
        rpm -Uvh --replacepkgs "$bundle_dir/ablecube-agent.rpm"
    fi
fi
systemctl daemon-reload
exec /usr/libexec/ablestack/node-setup --bundle "$bundle_dir" --restart
