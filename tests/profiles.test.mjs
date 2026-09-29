import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_KEY, CAPTURE_KEY, normalizeConfig, saveProfile, switchProfile, writeConfig, readConfig, captureBoardRules, createService, rgb, rulesFromNets } from '../src/core.mjs';

function fixture() {
  const store = new Map(); let doc = { documentType: 3, uuid: 'pcb', tabId: 'tab' };
  let nets = [{ net: 'GND', color: { r: 12 / 255, g: 34 / 255, b: 56 / 255, alpha: 0.4 } }, { net: 'VCC', color: rgb('#000000') }];
  const calls = [];
  const api = {
    sys_Storage: { getExtensionUserConfig: key => structuredClone(store.get(key)), setExtensionUserConfig: async (key, value) => { store.set(key, structuredClone(value)); return true; } },
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ ...doc }) },
    pcb_Net: { getAllNets: async () => structuredClone(nets), setNetColor: async (net, color) => { calls.push([net, color]); nets.find(n => n.net === net).color = color; return true; } },
  };
  return { api, store, calls, setNets(v) { nets = v; }, setDoc(v) { doc = v; } };
}

test('actual engine normalized RGB: primary colors, dark values, default sentinel and alpha', () => {
  assert.deepEqual(rgb('#FF0000'), { r: 1, g: 0, b: 0, alpha: 1 });
  for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#010101', '#27AE60']) {
    assert.deepEqual(rulesFromNets([{ net: 'N', color: rgb(hex) }]), [{ net: 'N', color: hex }]);
  }
  assert.deepEqual(rulesFromNets([{ net: 'N', color: { r: 0, g: 0, b: 0, alpha: 0.5 } }]), [{ net: 'N', color: '#000000', alpha: 0.5 }]);
  assert.deepEqual(rulesFromNets([{ net: 'N', color: rgb('#000000') }]), [{ net: 'N', color: null }]);
  assert.throws(() => rulesFromNets([{ net: 'N', color: { r: 255, g: 0, b: 0, alpha: 1 } }]), /格式/);
});

test('save verifies storage readback and does not claim success for a dropped write', async () => {
  const f = fixture(); f.api.sys_Storage.setExtensionUserConfig = async () => true;
  await assert.rejects(writeConfig(f.api, saveProfile(readConfig(f.api), 'A', [{ net: 'N', color: '#FF0000' }])), /校验失败/);
});

test('default reset uses engine black sentinel and no repeated writes after restoration', async () => {
  const f = fixture();
  f.setNets([{ net: 'N', color: rgb('#FF0000') }]);
  const set = f.api.pcb_Net.setNetColor;
  f.api.pcb_Net.setNetColor = async (net, color) => color === null ? false : set(net, color);
  await writeConfig(f.api, saveProfile(readConfig(f.api), 'A', [{ net: 'N', color: null }]));
  const service = createService(f.api);
  assert.equal((await service.tick()).changed, 1);
  assert.deepEqual(f.calls[0], ['N', { r: 0, g: 0, b: 0, alpha: 1 }]);
  assert.equal((await service.tick()).changed, 0);
});

test('legacy migration preserves rules; independent profiles persist and only selected profile applies', async () => {
  const f = fixture();
  f.store.set(CONFIG_KEY, { version: 1, enabled: true, rules: [{ net: 'GND', color: '#123456' }] });
  const original = readConfig(f.api);
  assert.equal(original.profiles[0].name, '默认配置');
  let next = saveProfile(original, '电源板', [{ net: 'GND', color: '#FF0000' }]);
  next = await writeConfig(f.api, next);
  assert.equal(next.profiles.length, 2);
  await createService(f.api).tick();
  assert.deepEqual(f.calls.at(-1), ['GND', rgb('#FF0000')]);
  next = switchProfile(readConfig(f.api), 'default');
  await writeConfig(f.api, next); await createService(f.api).tick();
  assert.deepEqual(f.calls.at(-1), ['GND', rgb('#123456')]);
  next.rules = [{ net: 'VCC', color: '#000000' }]; await writeConfig(f.api, next);
  assert.equal(readConfig(f.api).profiles[1].rules[0].color, '#FF0000');
  assert.throws(() => saveProfile(next, '电源板', [], false), /同名/);
  assert.equal(saveProfile(next, '电源板', [], true).profiles[1].rules.length, 0);
  assert.throws(() => switchProfile(next, 'absent'), /不存在/);
});

test('snapshot reads board colors including default and alpha, stores without painting, restores on another board', async () => {
  const f = fixture(); const rules = await captureBoardRules(f.api);
  assert.deepEqual(rules, [{ net: 'GND', color: '#0C2238', alpha: 0.4 }, { net: 'VCC', color: null }]);
  assert.equal(f.store.get(CAPTURE_KEY), null); assert.equal(f.calls.length, 0);
  const saved = await writeConfig(f.api, saveProfile(readConfig(f.api), 'PCB 快照', rules));
  assert.deepEqual(normalizeConfig(JSON.parse(JSON.stringify(saved))), saved);
  f.setDoc({ documentType: 3, uuid: 'new', tabId: 'new' });
  f.setNets([{ net: 'GND', color: null }, { net: 'VCC', color: rgb('#FFFFFF') }, { net: 'OTHER', color: rgb('#112233') }]);
  assert.equal((await createService(f.api).tick()).changed, 2);
  assert.deepEqual(f.calls, [['GND', { r: 12 / 255, g: 34 / 255, b: 56 / 255, alpha: 0.4 }], ['VCC', rgb('#000000')]]);
});

test('snapshot refuses changed documents/colors, empty and malformed data; always releases lock', async () => {
  const f = fixture(); const get = f.api.pcb_Net.getAllNets;
  f.api.pcb_Net.getAllNets = async () => { const nets = await get(); f.setDoc({ documentType: 3, uuid: 'other', tabId: 'other' }); return nets; };
  await assert.rejects(captureBoardRules(f.api), /切换/); assert.equal(f.store.get(CAPTURE_KEY), null);
  let count = 0;
  f.api.pcb_Net.getAllNets = async () => [{ net: 'GND', color: rgb(++count === 1 ? '#000000' : '#FFFFFF') }];
  await assert.rejects(captureBoardRules(f.api), /变化/);
  f.api.pcb_Net.getAllNets = async () => [];
  await assert.rejects(captureBoardRules(f.api), /没有/);
  f.setDoc({ documentType: 1 }); await assert.rejects(captureBoardRules(f.api), /打开/);
  assert.throws(() => rulesFromNets([{ net: 'GND', color: { r: 999, g: 0, b: 0, alpha: 1 } }]), /格式/);
});

test('capture lease pauses service and expired lease cannot permanently stop auto coloring', async () => {
  const f = fixture(); await writeConfig(f.api, saveProfile(readConfig(f.api), 'A', [{ net: 'GND', color: '#000000' }]));
  f.store.set(CAPTURE_KEY, { expiresAt: Date.now() + 10000 });
  assert.equal((await createService(f.api).tick()).paused, true); assert.equal(f.calls.length, 0);
  f.store.set(CAPTURE_KEY, { expiresAt: Date.now() - 1 });
  assert.equal((await createService(f.api).tick()).changed, 1);
});
