import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_KEY, STATUS_KEY, createService, documentKey, normalizeConfig, readConfig, rgb, selectedNets, writeConfig } from '../src/core.mjs';

function fixture() {
  const store = new Map();
  let doc = { uuid: 'board-a', tabId: 'a', documentType: 3, parentProjectUuid: 'project-a' };
  const boards = new Map([['board-a', new Map([['GND', null], ['VCC', null], ['gnd', null]])], ['board-b', new Map([['GND', null]])]]);
  const calls = [];
  let fail = false;
  const api = {
    sys_Storage: {
      getExtensionUserConfig: key => structuredClone(store.get(key)),
      setExtensionUserConfig: async (key, value) => { store.set(key, structuredClone(value)); return true; },
    },
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ ...doc }) },
    pcb_Net: {
      getAllNets: async () => [...boards.get(doc.uuid)].map(([net, color]) => ({ net, color })),
      setNetColor: async (net, color) => { if (fail) return false; calls.push([doc.uuid, net, color]); boards.get(doc.uuid).set(net, color); return true; },
    },
  };
  store.set(CONFIG_KEY, { version: 1, enabled: true, rules: [{ net: 'GND', color: '#27AE60' }] });
  return { api, store, calls, boards, switchDoc(value) { doc = value; }, setFail(value) { fail = value; } };
}

test('saved rules persist across a service restart and new PCB; exact net names only', async () => {
  const f = fixture();
  const service = createService(f.api);
  assert.equal((await service.tick()).changed, 1);
  assert.equal((await service.tick()).changed, 0);
  assert.equal(f.boards.get('board-a').get('VCC'), null);
  assert.equal(f.boards.get('board-a').get('gnd'), null);
  service.dispose();
  f.switchDoc({ uuid: 'board-b', tabId: 'b', documentType: 3 });
  assert.equal((await createService(f.api).tick()).changed, 1);
  assert.deepEqual(f.boards.get('board-b').get('GND'), rgb('#27AE60'));
});
test('rules for absent nets apply when those nets appear later', async () => {
  const f = fixture(); const config = readConfig(f.api);
  config.rules.push({ net: '+3V3', color: '#123456' }); await writeConfig(f.api, config);
  const service = createService(f.api); await service.tick();
  f.boards.get('board-a').set('+3V3', null);
  assert.equal((await service.tick()).changed, 1);
  assert.deepEqual(f.boards.get('board-a').get('+3V3'), rgb('#123456'));
});
test('pause, manual apply, delete and storage failure', async () => {
  const f = fixture(); const config = readConfig(f.api); config.enabled = false;
  await writeConfig(f.api, config); const service = createService(f.api);
  assert.equal((await service.tick()).paused, true);
  config.request = { id: 'manual', documentKey: documentKey(await f.api.dmt_SelectControl.getCurrentDocumentInfo()) };
  await writeConfig(f.api, config);
  assert.equal((await service.tick()).changed, 1);
  assert.deepEqual(f.store.get(STATUS_KEY).errors, []);
  assert.equal((await service.tick()).paused, true);
  config.enabled = true; config.rules = []; config.request = null; await writeConfig(f.api, config);
  assert.equal((await service.tick()).changed, 0);
  assert.deepEqual(f.boards.get('board-a').get('GND'), rgb('#27AE60'));
  f.api.sys_Storage.setExtensionUserConfig = async () => false;
  await assert.rejects(() => writeConfig(f.api, config), /保存失败/);
});
test('document switch during a read cancels all pending writes', async () => {
  const f = fixture(); const service = createService(f.api);
  const original = f.api.pcb_Net.getAllNets;
  f.api.pcb_Net.getAllNets = async () => { const result = await original(); f.switchDoc({ uuid: 'board-b', tabId: 'b', documentType: 3 }); service.invalidate(); return result; };
  assert.equal((await service.tick()).cancelled, true);
  assert.equal(f.calls.length, 0);
});
test('changing rules during a read stops old colors from being applied', async () => {
  const f = fixture(); const original = f.api.pcb_Net.getAllNets;
  f.api.pcb_Net.getAllNets = async () => { const result = await original(); const c = readConfig(f.api); c.rules = []; await writeConfig(f.api, c); return result; };
  assert.equal((await createService(f.api).tick()).cancelled, true); assert.equal(f.calls.length, 0);
});
test('failed color writes report errors and automatic retries succeed', async () => {
  const f = fixture(); f.setFail(true); const service = createService(f.api);
  assert.equal((await service.tick()).errors.length, 1); assert.equal(f.calls.length, 0);
  f.setFail(false); assert.equal((await service.tick()).changed, 1);
});
test('non-PCB documents, overlapping ticks and deactivation cause no writes', async () => {
  const f = fixture(); f.switchDoc({ documentType: 1, uuid: 'sch', tabId: 'sch' });
  const service = createService(f.api); assert.equal((await service.tick()).idle, true);
  f.switchDoc({ documentType: 3, uuid: 'board-a', tabId: 'a' });
  let release; f.api.pcb_Net.getAllNets = () => new Promise(resolve => { release = resolve; });
  const first = service.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await service.tick()).busy, true);
  service.dispose(); release([{ net: 'GND', color: null }]);
  assert.equal((await first).cancelled, true); assert.equal(f.calls.length, 0);
});
test('invalid imports rejected, special names safe, selection never guesses whole component', () => {
  assert.throws(() => normalizeConfig({ version: 1, rules: [{ net: 'GND', color: 'red' }] }));
  assert.throws(() => normalizeConfig({ version: 2, rules: [] }));
  assert.equal(normalizeConfig({ version: 1, rules: [{ net: '__proto__', color: '#abcdef' }] }).rules[0].color, '#ABCDEF');
  assert.deepEqual(selectedNets([{ primitiveType: 'Pad', net: 'GND' }, { primitiveType: 'Line', net: 'GND' }, { primitiveType: 'Component', net: 'VCC' }, { getState_Net: () => '+3V3' }]), ['GND', '+3V3']);
});
