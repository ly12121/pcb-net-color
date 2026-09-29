export const CONFIG_KEY = 'pcb-net-color-brush.v1';
export const STATUS_KEY = 'pcb-net-color-brush.status.v1';
export const CAPTURE_KEY = 'pcb-net-color-brush.capture.v1';
export const documentKey = doc => doc?.documentType === 3 && doc.uuid && doc.tabId
  ? JSON.stringify([doc.parentProjectUuid || '', doc.uuid, doc.tabId]) : '';

export function normalizeRules(input) {
  if (!Array.isArray(input)) throw new Error('配色规则必须是列表。');
  const rules = new Map();
  for (const rule of input) {
    if (!rule || typeof rule.net !== 'string' || !rule.net.trim() || (rule.color !== null && !/^#[\da-f]{6}$/i.test(rule.color))
      || (rule.alpha !== undefined && (!Number.isFinite(rule.alpha) || rule.alpha < 0 || rule.alpha > 1))) {
      throw new Error('配色规则包含无效网络名或颜色。');
    }
    rules.set(rule.net, { net: rule.net, color: rule.color === null ? null : rule.color.toUpperCase(),
      ...(rule.color !== null && rule.alpha !== undefined && rule.alpha !== 1 ? { alpha: rule.alpha } : {}) });
  }
  return [...rules.values()];
}

export function normalizeConfig(raw) {
  if (raw == null || raw.version === 1) {
    if (raw != null && !Array.isArray(raw.rules)) throw new Error('旧版配色规则格式无效，请先备份，勿覆盖配置。');
    const rules = normalizeRules(raw?.rules ?? []);
    return { version: 2, enabled: raw?.enabled !== false, profiles: [{ id: 'default', name: '默认配置', rules }], activeProfileId: 'default', rules, request: raw?.request || null };
  }
  if (raw.version !== 2 || !Array.isArray(raw.profiles) || !raw.profiles.length) throw new Error('已保存配色格式无法识别；请先导出备份，勿覆盖配置。');
  const ids = new Set(); const names = new Set();
  const profiles = raw.profiles.map(profile => {
    if (!profile || typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.trim().length > 60 || ids.has(profile.id) || names.has(profile.name.trim())) throw new Error('配置名称或 ID 无效、重复。');
    ids.add(profile.id); names.add(profile.name.trim());
    return { id: profile.id, name: profile.name.trim(), rules: normalizeRules(profile.rules) };
  });
  const active = profiles.find(profile => profile.id === raw.activeProfileId);
  if (!active) throw new Error('当前配置不存在，请检查备份。');
  return { version: 2, enabled: raw.enabled !== false, profiles, activeProfileId: active.id, rules: active.rules.map(rule => ({ ...rule })), request: raw.request || null };
}

export function switchProfile(config, id) {
  return normalizeConfig({ ...config, activeProfileId: id, request: null });
}

export function saveProfile(config, name, rules, overwrite = false) {
  const next = normalizeConfig(config);
  name = name.trim();
  if (!name || name.length > 60) throw new Error('请输入 1～60 个字符的配置名称。');
  let profile = next.profiles.find(item => item.name === name);
  if (profile && !overwrite) throw new Error('同名配置已存在；请改名或勾选“允许覆盖同名配置”。');
  if (!profile) { profile = { id: `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, rules: [] }; next.profiles.push(profile); }
  profile.rules = normalizeRules(rules);
  return switchProfile(next, profile.id);
}

export function deleteProfile(config, id) {
  const next = normalizeConfig(config);
  if (!next.profiles.some(profile => profile.id === id)) throw new Error('配置不存在。');
  next.profiles = next.profiles.filter(profile => profile.id !== id);
  if (!next.profiles.length) next.profiles = [{ id: 'default', name: '默认配置', rules: [] }];
  // Deleting the active profile must not repaint the board with another profile.
  if (next.activeProfileId === id) {
    next.activeProfileId = next.profiles[0].id;
    next.enabled = false;
  }
  next.request = null;
  return normalizeConfig(next);
}

export const readConfig = api => normalizeConfig(api.sys_Storage.getExtensionUserConfig(CONFIG_KEY));
export async function writeConfig(api, config) {
  // Keep the editable active rules in sync without touching other profiles.
  const candidate = config.version === 2 ? { ...config, profiles: config.profiles.map(profile => profile.id === config.activeProfileId ? { ...profile, rules: config.rules } : profile) } : config;
  const normalized = normalizeConfig(candidate);
  const legacy = api.sys_Storage.getExtensionUserConfig(CONFIG_KEY);
  if (legacy?.version === 1 && api.sys_Storage.getExtensionUserConfig(`${CONFIG_KEY}.legacy-backup`) == null) {
    if (await api.sys_Storage.setExtensionUserConfig(`${CONFIG_KEY}.legacy-backup`, legacy) !== true) throw new Error('旧版配色备份失败，未覆盖配置。');
  }
  if (await api.sys_Storage.setExtensionUserConfig(CONFIG_KEY, normalized) !== true) {
    throw new Error('配色保存失败，请检查扩展存储后重试。');
  }
  if (JSON.stringify(readConfig(api)) !== JSON.stringify(normalized)) throw new Error('配色保存后校验失败，请重试或导出备份。');
  return normalized;
}
export function rgb(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('颜色必须是 #RRGGBB 格式。');
  // Installed EDA PCB engine uses normalized RGB, including pure red = (1,0,0).
  return { r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255, alpha: 1 };
}
export function sameColor(actual, expected) {
  if (expected === null) return actual === null;
  if (actual === null) return expected.r === 0 && expected.g === 0 && expected.b === 0 && expected.alpha === 1;
  return !!actual && ['r', 'g', 'b', 'alpha'].every(key => Number.isFinite(actual[key]) && Math.abs(actual[key] - expected[key]) < 1e-8);
}
// The installed engine rejects null writes; opaque black is its default-color sentinel.
export const ruleColor = rule => rule.color === null ? rgb('#000000') : { ...rgb(rule.color), alpha: rule.alpha ?? 1 };

export function rulesFromNets(nets) {
  if (!Array.isArray(nets)) throw new Error('无法读取 PCB 网络列表。');
  return normalizeRules(nets.filter(item => typeof item.net === 'string' && item.net.trim()).map(item => {
    if (item.color === null) return { net: item.net, color: null };
    const c = item.color;
    if (!c || ![c.r, c.g, c.b].every(v => Number.isFinite(v) && v >= 0 && v <= 1) || !Number.isFinite(c.alpha) || c.alpha < 0 || c.alpha > 1) throw new Error(`网络 ${item.net} 的颜色格式无法读取，未保存配置。`);
    if (c.r === 0 && c.g === 0 && c.b === 0 && c.alpha === 1) return { net: item.net, color: null };
    return { net: item.net, color: '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), alpha: c.alpha };
  }));
}

export async function captureBoardRules(api) {
  const key = documentKey(await api.dmt_SelectControl.getCurrentDocumentInfo());
  if (!key) throw new Error('请先打开一个 PCB。');
  const token = `${Date.now()}-${Math.random()}`;
  if (await api.sys_Storage.setExtensionUserConfig(CAPTURE_KEY, { token, expiresAt: Date.now() + 15000 }) !== true) throw new Error('无法暂停后台刷色，未读取快照。');
  try {
    const first = rulesFromNets(await api.pcb_Net.getAllNets());
    const second = rulesFromNets(await api.pcb_Net.getAllNets());
    if (documentKey(await api.dmt_SelectControl.getCurrentDocumentInfo()) !== key) throw new Error('读取期间 PCB 已切换，未保存，请重试。');
    const sorted = rules => JSON.stringify([...rules].sort((a, b) => a.net.localeCompare(b.net)));
    if (sorted(first) !== sorted(second)) throw new Error('读取期间网络颜色发生变化，请重试。');
    if (!second.length) throw new Error('当前 PCB 没有可保存的网络。');
    return second;
  } finally {
    if (api.sys_Storage.getExtensionUserConfig(CAPTURE_KEY)?.token === token) await api.sys_Storage.setExtensionUserConfig(CAPTURE_KEY, null);
  }
}
export function selectedNets(items) {
  return [...new Set((Array.isArray(items) ? items : []).map(item => {
    // Do not infer a net from the whole component: its pads can have different nets.
    if (item?.primitiveType === 'Component' || item?.getState_PrimitiveType?.() === 'Component') return '';
    return item?.net ?? item?.getState_Net?.();
  }).filter(net => typeof net === 'string' && net.trim()))];
}

export function createService(api) {
  let busy = false;
  let generation = 0;
  let disposed = false;
  let completedRequest = '';
  const invalidate = () => { generation += 1; };
  async function tick(force = false) {
    if (busy || disposed) return { busy: true };
    busy = true;
    const epoch = generation;
    try {
      const capturing = () => api.sys_Storage.getExtensionUserConfig(CAPTURE_KEY)?.expiresAt > Date.now();
      if (capturing()) return { paused: true };
      const config = readConfig(api);
      const doc = await api.dmt_SelectControl.getCurrentDocumentInfo();
      const key = documentKey(doc);
      if (!key) return { idle: true };
      const request = config.request;
      const requested = request?.id && request.id !== completedRequest && request.documentKey === key;
      if (!config.enabled && !requested && !force) return { paused: true };
      if (typeof api.pcb_Net?.setNetColor !== 'function') throw new Error('当前 EDA 版本不支持设置网络颜色，请升级嘉立创 EDA 专业版。');
      const snapshot = JSON.stringify(config);
      const unchanged = async () => !disposed && epoch === generation && !capturing()
        && documentKey(await api.dmt_SelectControl.getCurrentDocumentInfo()) === key
        && JSON.stringify(readConfig(api)) === snapshot;
      const nets = await api.pcb_Net.getAllNets();
      const actual = new Map(nets.map(net => [net.net, net.color]));
      let changed = 0;
      const errors = [];
      for (const rule of config.rules) {
        if (!actual.has(rule.net)) continue;
        const color = ruleColor(rule);
        if (sameColor(actual.get(rule.net), color)) continue;
        if (!await unchanged()) return { cancelled: true };
        try {
          if (await api.pcb_Net.setNetColor(rule.net, color) !== true) throw new Error('网络不存在或设置未成功');
          changed += 1;
        } catch (error) { errors.push(`${rule.net}：${error.message || error}`); }
      }
      if (!await unchanged()) return { cancelled: true };
      // Request completion is reported separately from saving preferences.
      if (requested) {
        const success = await api.sys_Storage.setExtensionUserConfig(STATUS_KEY, {
          id: request.id, documentKey: key, changed, errors,
        });
        if (success === true) completedRequest = request.id;
      }
      return { changed, errors };
    } finally { busy = false; }
  }
  return { tick, invalidate, dispose() { disposed = true; invalidate(); } };
}
