import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.EDA_BUILD_DEPS ? path.resolve(process.env.EDA_BUILD_DEPS, 'package.json') : import.meta.url);
const JSZip = require('jszip');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension.json'), 'utf8'));
const eext = path.join(root, 'release', `${manifest.name}_v${manifest.version}.eext`);
const archive = await JSZip.loadAsync(await fs.readFile(eext));
for (const required of ['extension.json', 'dist/index.js', 'iframe/index.html', 'iframe/position.js', 'iframe/panel.js', 'images/logo.png', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
  if (!archive.file(required)) throw new Error(`安装包缺少 ${required}`);
}
const packed = JSON.parse(await archive.file('extension.json').async('string'));
if (packed.name !== manifest.name || packed.uuid !== manifest.uuid || packed.displayName !== 'PCB网络刷色') throw new Error('扩展清单不一致');
const zip = new JSZip();
async function add(dir, prefix = '') {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'release', '.git'].includes(entry.name)) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await add(path.join(dir, entry.name), relative + '/');
    else zip.file(relative, await fs.readFile(path.join(dir, entry.name)));
  }
}
await add(root);
const target = path.join(root, 'release', `${manifest.name}-source-v${manifest.version}.zip`);
await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Package verified: ${Object.keys(archive.files).filter(name => !archive.files[name].dir).length} files`);
console.log(`Source: ${target}`);
