import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.EDA_BUILD_DEPS ? path.resolve(process.env.EDA_BUILD_DEPS, 'package.json') : import.meta.url);
const esbuild = require('esbuild');
const JSZip = require('jszip');
await esbuild.build({ entryPoints: [path.join(root, 'src/index.js')], bundle: true, format: 'iife', globalName: 'edaEsbuildExportName', platform: 'browser', outfile: path.join(root, 'dist/index.js'), minify: false });
await esbuild.build({ entryPoints: [path.join(root, 'src/panel.js')], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(root, 'iframe/panel.js'), minify: false });
const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension.json'), 'utf8'));
for (const field of ['name', 'uuid', 'displayName', 'description', 'version', 'license']) {
  if (typeof manifest[field] !== 'string' || !manifest[field].trim()) throw new Error('发布清单缺少字段：' + field);
}
if (!manifest.repository?.type || !manifest.repository?.url?.startsWith('https://')) throw new Error('发布清单缺少有效仓库地址');
const zip = new JSZip();
for (const file of ['extension.json', 'dist/index.js', 'iframe/index.html', 'iframe/position.js', 'iframe/panel.js', 'images/logo.png', 'images/pcb-net-color-demo.png', 'README.md', 'CHANGELOG.md', 'LICENSE']) zip.file(file, await fs.readFile(path.join(root, file)));
await fs.mkdir(path.join(root, 'release'), { recursive: true });
const output = path.join(root, 'release', `${manifest.name}_v${manifest.version}.eext`);
await fs.writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(output);
