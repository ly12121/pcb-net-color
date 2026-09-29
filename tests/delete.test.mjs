import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, saveProfile, deleteProfile } from '../src/core.mjs';
test('delete inactive, active and last profile safely; original configuration remains unchanged', () => {
  const config = saveProfile(normalizeConfig(null), 'A', [{ net: 'GND', color: '#FFFFFF' }]);
  const inactive = deleteProfile(config, 'default');
  assert.equal(inactive.enabled, true);
  assert.equal(inactive.rules.length, 1);
  const active = deleteProfile(config, config.activeProfileId);
  assert.equal(active.enabled, false);
  assert.equal(active.activeProfileId, 'default');
  assert.deepEqual(active.rules, []);
  const last = deleteProfile(inactive, inactive.activeProfileId);
  assert.equal(last.profiles.length, 1);
  assert.deepEqual(last.rules, []);
  assert.equal(last.enabled, false);
  assert.equal(config.profiles.length, 2);
  assert.throws(() => deleteProfile(config, 'missing'), /不存在/);
});
