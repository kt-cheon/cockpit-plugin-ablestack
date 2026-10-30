/* ABLESTACK operations always use Cockpit's authenticated administrator bridge. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory;
  } else {
    root.ablestack = factory(root.cockpit);
  }
}(typeof window === "undefined" ? globalThis : window, function (cockpit) {
  "use strict";

  const remoteCommand = "/usr/libexec/ablestack/node-remote";

  function elevated(options) {
    return Object.assign({}, options || {}, { superuser: "require" });
  }

  function processOptions(options) {
    const result = elevated(options);
    if (!result.directory) result.directory = "/root";
    const environ = (result.environ || []).slice();
    ["HOME=/root", "LIBVIRT_DEFAULT_URI=qemu:///system"].forEach(function (setting) {
      const name = setting.slice(0, setting.indexOf("=") + 1);
      if (!environ.some(function (entry) { return entry.indexOf(name) === 0; })) {
        environ.push(setting);
      }
    });
    result.environ = environ;
    return result;
  }

  function spawn(command, options) {
    const result = processOptions(options);
    if (result.host) {
      const remoteOptions = { environ: result.environ };
      if (result.directory) remoteOptions.directory = result.directory;
      const argv = [remoteCommand, "exec", "--target", result.host,
        "--argv-json", JSON.stringify(command), "--options-json", JSON.stringify(remoteOptions)];
      delete result.host;
      result.directory = "/root";
      return cockpit.spawn(argv, result);
    }
    delete result.host;
    return cockpit.spawn(command, result);
  }

  function script(source, args, options) {
    if (!Array.isArray(args)) {
      if (options === undefined) options = args;
      args = [];
    }
    if (options && options.host) {
      return spawn(["/bin/bash", "-c", String(source), "ablestack-script"].concat(args), options);
    }
    return cockpit.script(source, args || [], processOptions(options));
  }

  return Object.freeze({
    spawn: spawn,
    script: script,
    file: function (path, options) { return cockpit.file(path, elevated(options)); }
  });
}));
