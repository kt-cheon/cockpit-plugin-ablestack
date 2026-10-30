/* Run with node, or JavaScriptCore's jsc. No commands or services are executed. */
async function testPrivileged(factory, indexSource) {
  function assert(value, message) { if (!value) throw new Error(message); }
  const calls = [];
  const handle = { input() {}, stream() {}, close() {} };
  const native = {
    spawn(...args) { calls.push(["spawn", ...args]); return handle; },
    script(...args) { calls.push(["script", ...args]); return handle; },
    file(...args) { calls.push(["file", ...args]); return handle; }
  };
  const api = factory(native);
  const options = { superuser: "try", binary: true, environ: ["CUSTOM=value"] };
  assert(api.spawn(["id", "-u"], options) === handle, "preserve Cockpit process handles");
  assert(options.superuser === "try" && options.environ.length === 1, "do not mutate caller options");
  let call = calls.pop();
  assert(call[2].superuser === "require" && call[2].binary, "require administrator bridge and preserve binary mode");
  assert(call[2].environ.includes("HOME=/root"), "privileged tasks use root HOME");
  assert(call[2].directory === "/root", "legacy relative paths do not use the login user's home");
  assert(call[2].environ.includes("LIBVIRT_DEFAULT_URI=qemu:///system"), "use system libvirt connection");
  api.script("echo test", { superuser: false, err: "message" });
  call = calls.pop();
  assert(call[2].length === 0 && call[3].superuser === "require" && call[3].err === "message", "script overload accepts options");
  api.script("echo $1", ["test"], { binary: true });
  call = calls.pop();
  assert(call[2][0] === "test" && call[3].binary, "script arguments and options remain intact");
  api.file("/root/example", { syntax: JSON, superuser: "try" });
  call = calls.pop();
  assert(call[2].superuser === "require" && call[2].syntax === JSON, "privileged file access keeps syntax");
  const argv = ["printf", "%s", "argument with spaces; $(false)"];
  api.spawn(argv, { host: "cube2", directory: "/var/lib", err: "message" });
  call = calls.pop();
  assert(call[1][0] === "/usr/libexec/ablestack/node-remote", "remote calls use node transport");
  assert(!("host" in call[2]) && call[2].directory === "/root", "keep remote settings out of the local Cockpit channel");
  assert(JSON.parse(call[1][call[1].indexOf("--argv-json") + 1])[2] === argv[2], "remote argument boundaries survive");
  assert(JSON.parse(call[1][call[1].indexOf("--options-json") + 1]).directory === "/var/lib", "remote working directory is forwarded");
  api.script("printf '%s' \"$1\"", ["value"], { host: "cube2" });
  assert(calls.pop()[1][0] === "/usr/libexec/ablestack/node-remote", "remote scripts also avoid Cockpit SSH");

  const routes = [];
  const errors = [];
  const permission = { allowed: false, addEventListener(event, callback) { this.changed = callback; } };
  const storage = new Map();
  let privilegedCalls = 0;
  let reloads = 0;
  const document = { documentElement: { classList: { contains() { return false; }, remove() {} } } };
  const window = { document, location: { reload() { reloads++; } } };
  window.parent = window;
  function $(selector) {
    return { ready(callback) { callback(); }, html(page) { routes.push(page); }, text(message) { errors.push(message); } };
  }
  $.get = function (page) { return Promise.resolve(page); };
  const sessionStorage = { setItem(key, value) { storage.set(key, value); } };
  const fakeApi = {
    spawn() { privilegedCalls++; return Promise.resolve("scvm1\n"); },
    file() { privilegedCalls++; return { read() { return Promise.resolve('{"clusterConfig":{"type":"powerflex","iscsi_storage":"false"}}'); } }; }
  };
  new Function("window", "document", "$", "cockpit", "ablestack", "sessionStorage", "MutationObserver", indexSource)(
    window, document, $, { permission() { return permission; } }, fakeApi, sessionStorage, undefined);
  await Promise.resolve();
  assert(privilegedCalls === 0 && routes[0] === "main-glue-no-permission.html", "unprivileged users never load features or run commands");
  permission.allowed = true;
  permission.changed();
  permission.changed();
  for (let flush = 0; flush < 8; flush++) await Promise.resolve();
  assert(routes[routes.length - 1] === "main-glue.html", "sudo administrator can open storage UI without a root login");
  assert(storage.get("os_type") === "powerflex" && !errors.length, "load configuration before feature scripts");
  assert(privilegedCalls === 2, "duplicate permission notifications do not duplicate work");
  permission.allowed = false;
  permission.changed();
  assert(reloads === 1, "dropping administrator access clears feature timers");
  return 16;
}

(function () {
  const isNode = typeof module === "object" && module.exports;
  const readSource = isNode ? require("fs").readFileSync : function (path) { return readFile(path); };
  const base = isNode ? require("path").join(__dirname, "..") : ".";
  const privilegedSource = readSource(base + "/src/common/privileged.js", "utf8");
  const indexSource = readSource(base + "/index.js", "utf8");
  const factory = new Function("module", privilegedSource + "; return module.exports;")({ exports: {} });
  testPrivileged(factory, indexSource).then(function (count) {
    if (isNode) console.log(count + " privilege and routing checks passed");
    else print(count + " privilege and routing checks passed");
  }).catch(function (error) {
    if (isNode) { console.error(error); process.exitCode = 1; }
    else { print(error.stack); quit(1); }
  });
}());
