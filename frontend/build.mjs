import { build, context } from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = fileURLToPath(new URL('../src/react/', import.meta.url));
const options = {
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  outdir: output,
  entryNames: 'index',
  bundle: true,
  minify: !process.argv.includes('--watch'),
  sourcemap: process.argv.includes('--watch'),
  target: ['chrome110', 'firefox115'],
  alias: { cockpit: './src/platform/cockpit.ts' },
  plugins: [sassPlugin({ silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions'] })],
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
};
await mkdir(output, { recursive: true });
await copyFile(new URL('LICENSE', import.meta.url), output + 'LICENSE');
if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
