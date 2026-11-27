import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const frontend = fileURLToPath(new URL('../../', import.meta.url));
export async function bundleModule(source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ablestack-react-test-'));
  const outfile = path.join(directory, 'test.mjs');
  await build({
    stdin: { contents: source, resolveDir: frontend, loader: 'tsx' },
    outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external',
    // Keep React dependencies resolvable from the frontend workspace.
    nodePaths: [path.join(frontend, 'node_modules')],
    alias: { cockpit: './src/platform/cockpit.ts' },
    plugins: [{ name: 'test-platform', setup(builder) {
      builder.onLoad({ filter: /platform\/cockpit\.ts$/ }, () => ({ contents: 'export default globalThis.__cockpitTestStub;', loader: 'ts' }));
      builder.onLoad({ filter: /\.(s?css)$/ }, () => ({ contents: '', loader: 'css' }));
    } }],
    external: [],
  });
  return import(pathToFileURL(outfile));
}

export function cockpitFixture(handler) {
  const calls = [];
  const cockpit = { spawn(argv, options) {
    let yes, no;
    const promise = new Promise((resolve, reject) => { yes = resolve; no = reject; });
    promise.input = (input) => {
      const request = JSON.parse(input);
      calls.push({ argv, options, request });
      Promise.resolve().then(() => handler(request)).then((value) => yes(JSON.stringify(value)), no);
    };
    return promise;
  } };
  return { cockpit, calls };
}
