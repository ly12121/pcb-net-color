import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../src/core.mjs';

class Element {
  constructor() { this.value = ''; this.children = []; this.checked = true; this.hidden = false; this.style = {}; this.dataset = {}; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}
test('panel can select a pad net, save a color, resolve multiple nets, and reports storage errors', async () => {
  const nodes = new Map(); const store = new Map(); let picker;
  const api = {
    sys_Storage: {
      getExtensionUserConfig: key => structuredClone(store.get(key)),
      setExtensionUserConfig: async (key, value) => { store.set(key, structuredClone(value)); return true; },
    },
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ documentType: 3, uuid: 'pcb', tabId: 'pcb' }) },
    pcb_Net: { getAllNets: async () => [{ net: 'GND', color: null }] },
    pcb_SelectControl: { getAllSelectedPrimitives: async () => [] },
    pcb_Event: {
      removeEventListener: () => {}, isEventListenerAlreadyExist: () => true,
      addMouseEventListener: (_id, _kind, fn) => { picker = fn; },
    },
  };
  const context = vm.createContext({ ...core, eda: api, console,
    document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement: () => new Element(), querySelectorAll: () => [] },
    window: { addEventListener: () => {} }, setInterval: () => 1, clearInterval: () => {},
  });
  const source = (await fs.readFile(new URL('../src/panel.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
  vm.runInContext(source, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle(); assert.ok(picker);
  const swatches = nodes.get('palette-grid').children;
  assert.equal(swatches.length, 240);
  assert.equal(new Set(swatches.map(s => s.title)).size, 240);
  swatches.forEach(s => assert.match(s.title, /^#[0-9A-F]{6}$/));
  swatches[100].onclick();
  assert.equal(nodes.get('hex').value, swatches[100].title);
  assert.equal(nodes.get('default-color').checked, false);
  assert.equal(nodes.get('palette-panel').hidden, true);
  nodes.get('palette-default').onclick();
  assert.equal(nodes.get('default-color').checked, true);
  await nodes.get('profile-copy').onclick();
  assert.match(nodes.get('message').textContent, /当前规则为空/);
  assert.equal(store.has(core.CONFIG_KEY), false);
  picker('selected', [{ primitiveType: 'Pad', net: 'GND' }]); await settle();
  assert.equal(nodes.get('net').value, 'GND');
  nodes.get('hex').value = '#abcdef'; await nodes.get('save').onclick();
  assert.equal(store.get(core.CONFIG_KEY).rules[0].color, '#ABCDEF');
  assert.ok(store.get(core.CONFIG_KEY).request.documentKey);
  picker('selected', [{ net: 'GND' }, { net: 'VCC' }]); await settle();
  assert.equal(nodes.get('net').value, ''); assert.equal(nodes.get('choices').hidden, false);
  nodes.get('choices').value = 'VCC'; nodes.get('choices').onchange(); assert.equal(nodes.get('net').value, 'VCC');
  context.document.getElementById('profile-name').value = '备用'; context.document.getElementById('overwrite-profile').checked = false;
  await nodes.get('profile-copy').onclick();
  assert.equal(store.get(core.CONFIG_KEY).profiles.length, 2);
  nodes.get('profile-name').value = 'PCB快照';
  await nodes.get('profile-capture').onclick();
  assert.equal(store.get(core.CONFIG_KEY).profiles.length, 3);
  assert.equal(store.get(core.CONFIG_KEY).rules[0].color, null);
  nodes.get('profiles').value = 'default'; await nodes.get('profile-apply').onclick();
  assert.equal(store.get(core.CONFIG_KEY).activeProfileId, 'default');
  assert.equal(store.get(core.CONFIG_KEY).rules[0].color, '#ABCDEF');
  nodes.get('export').onclick();
  assert.equal(JSON.parse(nodes.get('backup').value).profiles.length, 3);
  nodes.get('profile-name').value = '';
  nodes.get('overwrite-profile').checked = false;
  await nodes.get('profile-capture').onclick();
  assert.match(nodes.get('message').textContent, /配置名称/);
  nodes.get('overwrite-profile').checked = true;
  nodes.get('profiles').value = store.get(core.CONFIG_KEY).profiles.find(p => p.name === 'PCB快照').id;
  api.pcb_Net.getAllNets = async () => [{ net: 'GND', color: { r: 1, g: 0, b: 0, alpha: 1 } }];
  await nodes.get('profile-capture').onclick();
  assert.equal(store.get(core.CONFIG_KEY).profiles.length, 3);
  assert.equal(store.get(core.CONFIG_KEY).rules[0].color, '#FF0000');
  assert.match(nodes.get('message').textContent, /保存为“PCB快照”/);
  await nodes.get('import').onclick();
  assert.equal(store.get(core.CONFIG_KEY).profiles.length, 3);
  api.sys_Storage.setExtensionUserConfig = async () => false;
  nodes.get('profile-delete').onclick();
  assert.equal(nodes.get('delete-confirm').hidden, false);
  nodes.get('delete-cancel').onclick();
  assert.equal(nodes.get('delete-confirm').hidden, true);
  assert.equal(store.get(core.CONFIG_KEY).profiles.length, 3);
  await nodes.get('save').onclick(); assert.match(nodes.get('message').textContent, /保存失败/);
  assert.equal(store.get(core.CONFIG_KEY).rules.length, 1);
});
