import test from 'node:test';
import assert from 'node:assert/strict';
import { activate, deactivate, openPanel } from '../src/index.js';

test('startup registers one timer; modeless window opening does not wait for close; disable cleans up', async () => {
  const timers = new Map(); const events = new Map(); const windows = [];
  globalThis.eda = {
    sys_Storage: { getExtensionUserConfig: () => undefined },
    sys_Window: { getViewportSize: async () => ({ width: 1920, height: 1080 }) },
    dmt_SelectControl: { getCurrentDocumentInfo: async () => undefined },
    dmt_Event: {
      removeEventListener: id => events.delete(id),
      addEditorTabEventListener: (id, type, fn) => events.set(id, fn),
    },
    sys_Timer: {
      setIntervalTimer: (id, delay, fn) => { timers.set(id, { delay, fn }); return true; },
      clearIntervalTimer: id => timers.delete(id),
    },
    sys_IFrame: {
      openIFrame: (...args) => { windows.push(args); return new Promise(() => {}); },
      showIFrame: async () => true,
      closeIFrame: async () => true,
    },
    sys_Message: { showToastMessage: () => {} },
  };
  activate(); activate();
  assert.equal(timers.size, 1); assert.equal(events.size, 1);
  await openPanel(); await openPanel();
  assert.equal(windows.length, 1);
  assert.equal(windows[0][4].grayscaleMask, false);
  assert.equal(windows[0][1], 420);
  assert.equal(windows[0][2], 560);
  assert.equal(windows[0][4].x, 1172);
  assert.equal(windows[0][4].y, 136);
  windows[0][4].onBeforeCloseCallFn();
  assert.equal(timers.size, 1, 'closing the window must not stop auto coloring');
  await openPanel(); assert.equal(windows.length, 2);
  deactivate(); assert.equal(timers.size, 0); assert.equal(events.size, 0);
  delete globalThis.eda;
});
