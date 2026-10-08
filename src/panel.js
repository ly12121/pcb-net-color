import { CONFIG_KEY, STATUS_KEY, documentKey, readConfig, writeConfig, normalizeConfig, selectedNets, switchProfile, saveProfile, deleteProfile, captureBoardRules } from './core.mjs';
import { createFilterSession } from './filter.mjs';
const $ = id => document.getElementById(id);
const LISTENER = 'pcb-net-color-brush-picker';
let config;
let key = '';
let disposed = false;
let busy = false;
let picking = true;
let pending = null;
let refreshing = false;
let selectionEpoch = 0;
let filterSession;
function enableCanvasPick() {
  picking = true;
  try {
    if (!filterSession) filterSession = createFilterSession(window.frameElement?.ownerDocument);
    filterSession.enable();
    message('请点选焊盘、过孔、导线或铺铜。关闭窗口恢复过滤。');
  } catch (error) { message(`自动过滤不可用：${error.message}。请在过滤面板手动勾选相关图元。`, true); }
}
const message = (text, error = false) => { $('message').textContent = text; $('message').className = error ? 'error' : ''; };
const fail = error => message(String(error.message || error), true);
function updatePreview() {
  $('color').style.backgroundColor = $('hex').value;
  $('color').textContent = $('default-color').checked ? '默认' : '';
}
function selectColor(hex) {
  $('hex').value = hex;
  $('default-color').checked = false;
  updatePreview();
  $('palette-panel').hidden = true;
}
function initPalette() {
  // 24 grays and 216 hue / saturation / brightness variants, all unique.
  const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const colors = Array.from({ length: 24 }, (_, i) => hex([i * 255 / 23, i * 255 / 23, i * 255 / 23]));
  for (const [s, v] of [[1,.25],[1,.4],[1,.55],[1,.7],[1,.85],[1,1],[.75,1],[.5,1],[.25,1]]) {
    for (let h = 0; h < 24; h++) {
      const hue = h / 4; const c = v * s; const x = c * (1 - Math.abs(hue % 2 - 1)); const m = v - c;
      const channels = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(hue)];
      colors.push(hex(channels.map(n => (n + m) * 255)));
    }
  }
  for (const color of colors) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch'; swatch.style.backgroundColor = color;
    swatch.title = color; swatch.textContent = color;
    swatch.onclick = () => selectColor(color);
    $('palette-grid').append(swatch);
  }
  $('color').onclick = () => { $('palette-panel').hidden = !$('palette-panel').hidden; };
  $('palette-close').onclick = () => { $('palette-panel').hidden = true; };
  $('palette-default').onclick = () => { $('default-color').checked = true; updatePreview(); $('palette-panel').hidden = true; };
  $('default-color').onchange = updatePreview;
  updatePreview();
}
function colorForNet() {
  const rule = config.rules.find(rule => rule.net === $('net').value);
  $('default-color').checked = rule?.color === null;
  $('alpha').value = rule?.alpha ?? 1;
  if (rule?.color) { $('hex').value = rule.color; $('color').value = rule.color; }
  updatePreview();
}
function choose(net) { $('net').value = net; colorForNet(); message(`已选择网络：${net}。选择颜色后点击“保存配色并应用”。`); }
function render() {
  $('enabled').checked = config.enabled;
  $('profiles').replaceChildren();
  for (const profile of config.profiles) {
    const option = document.createElement('option'); option.value = profile.id;
    option.textContent = `${profile.name}（${profile.rules.length} 个网络）`; $('profiles').append(option);
  }
  $('profiles').value = config.activeProfileId;
  $('active-profile').textContent = config.profiles.find(item => item.id === config.activeProfileId).name;
  $('rules').replaceChildren();
  if (!config.rules.length) { $('rules').textContent = '还没有规则，先选择一个网络并保存颜色。'; return; }
  for (const rule of config.rules) {
    const row = document.createElement('div'); row.className = 'rule';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.backgroundColor = rule.color || 'transparent'; dot.style.opacity = rule.alpha ?? 1;
    const net = document.createElement('span'); net.className = 'net'; net.textContent = `${rule.net}  ${rule.color || 'EDA 默认颜色'}${rule.alpha !== undefined ? ` / 不透明度 ${rule.alpha}` : ''}`;
    const edit = document.createElement('button'); edit.textContent = '编辑'; edit.onclick = () => choose(rule.net);
    const remove = document.createElement('button'); remove.textContent = '删除'; remove.onclick = () => run(async () => {
      const next = readConfig(eda); next.rules = next.rules.filter(item => item.net !== rule.net); next.request = null;
      config = await writeConfig(eda, next); render(); message(`已删除 ${rule.net} 的自动配色规则；现有 PCB 颜色保留。`);
    });
    row.append(dot, net, edit, remove); $('rules').append(row);
  }
}
async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, input, select, textarea').forEach(button => { button.disabled = true; });
  try { await fn(); } catch (error) { fail(error); }
  finally { busy = false; document.querySelectorAll('button, input, select, textarea').forEach(button => { button.disabled = false; }); }
}
async function requestApply(next) {
  const current = documentKey(await eda.dmt_SelectControl.getCurrentDocumentInfo());
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  next.request = current ? { id, documentKey: current } : null;
  config = await writeConfig(eda, next);
  pending = current ? { id, at: Date.now(), documentKey: current } : null;
  render();
  message(current ? '配色已保存，正在套用当前 PCB…' : '配色已保存；打开 PCB 后自动套用同名网络。');
}
async function refreshNets() {
  const current = documentKey(await eda.dmt_SelectControl.getCurrentDocumentInfo());
  key = current;
  $('net-list').replaceChildren();
  if (!current) return;
  const nets = await eda.pcb_Net.getAllNets();
  if (documentKey(await eda.dmt_SelectControl.getCurrentDocumentInfo()) !== current) return;
  for (const net of nets) {
    if (!net.net) continue;
    const option = document.createElement('option'); option.value = net.net; $('net-list').append(option);
  }
}
async function pick(event, props) {
  if (event !== 'selected' || !picking || busy || disposed) return;
  const epoch = ++selectionEpoch;
  const current = documentKey(await eda.dmt_SelectControl.getCurrentDocumentInfo());
  if (!current) return;
  let nets = selectedNets(props);
  if (!nets.length) nets = selectedNets(await eda.pcb_SelectControl.getAllSelectedPrimitives());
  if (disposed || epoch !== selectionEpoch || documentKey(await eda.dmt_SelectControl.getCurrentDocumentInfo()) !== current) return;
  key = current;
  $('choices').replaceChildren(); $('choices').hidden = nets.length < 2;
  if (!nets.length) { message('所选图元没有网络。请直接点击焊盘、走线或过孔。'); return; }
  if (nets.length === 1) { choose(nets[0]); return; }
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '选中了多个网络，请选择一个'; $('choices').append(placeholder);
  for (const net of nets) { const option = document.createElement('option'); option.value = net; option.textContent = net; $('choices').append(option); }
  $('net').value = ''; message('选中了多个网络，请在下拉框中指定要刷色的网络。');
}
async function poll() {
  if (refreshing || disposed || busy) return;
  refreshing = true;
  try {
    const current = documentKey(await eda.dmt_SelectControl.getCurrentDocumentInfo());
    if (current !== key) {
      selectionEpoch += 1; $('net').value = ''; $('choices').hidden = true;
      await refreshNets(); message('文档已切换，请重新选择网络；自动配色将套用已保存规则。');
    }
    if (pending) {
      const status = eda.sys_Storage.getExtensionUserConfig(STATUS_KEY);
      if (status?.id === pending.id) {
        message(status.errors?.length ? `配色已保存，但部分网络设置失败：\n${status.errors.join('\n')}` : `已套用配色，更新 ${status.changed} 个网络。不存在的网络规则会保留供后续 PCB 使用。`, !!status.errors?.length);
        pending = null;
      } else if (Date.now() - pending.at > 10000) {
        message('规则已保存，尚未收到应用结果。请回到目标 PCB，或使用顶部菜单“立即套用已保存配色”；如仍无响应，请重新启用扩展。', true); pending = null;
      }
    }
  } catch (error) { fail(error); } finally { refreshing = false; }
}
async function start() {
  config = readConfig(eda); render();
  initPalette();
  $('profile-delete').onclick = () => {
    const selected = readConfig(eda).profiles.find(p => p.id === $('profiles').value);
    if (!selected) return;
    $('delete-label').textContent = `删除“${selected.name}”？`;
    $('delete-confirm').hidden = false;
    $('delete-confirm').dataset.profileId = selected.id;
  };
  $('delete-cancel').onclick = () => { $('delete-confirm').hidden = true; };
  $('delete-ok').onclick = () => run(async () => {
    const next = readConfig(eda);
    const id = $('delete-confirm').dataset.profileId;
    const active = id === next.activeProfileId;
    config = await writeConfig(eda, deleteProfile(next, id));
    pending = null; $('delete-confirm').hidden = true; render();
    message(active ? '已删除；自动配色已暂停，PCB 颜色保留。' : '配置已删除，PCB 颜色保留。');
  });
  $('profile-apply').onclick = () => run(() => requestApply(switchProfile(readConfig(eda), $('profiles').value)));
  $('profile-copy').onclick = () => run(async () => {
    const next = readConfig(eda);
    if (!next.rules.length) throw new Error('当前规则为空。要保存画布已有颜色，请点击“保存当前 PCB 颜色”。');
    config = await writeConfig(eda, saveProfile(next, $('profile-name').value, next.rules, $('overwrite-profile').checked));
    pending = null; render(); message('规则已另存为当前配置，后续 PCB 使用此配置。');
  });
  $('profile-capture').onclick = () => run(async () => {
    const overwrite = $('overwrite-profile').checked;
    const selected = readConfig(eda).profiles.find(profile => profile.id === $('profiles').value);
    const name = $('profile-name').value.trim() || (overwrite ? selected?.name || '' : '');
    // Validate naming/overwrite permission before reading the board.
    saveProfile(readConfig(eda), name, [], overwrite);
    message('正在读取并保存当前 PCB 的网络颜色…');
    const rules = await captureBoardRules(eda);
    config = await writeConfig(eda, saveProfile(readConfig(eda), name, rules, overwrite));
    pending = null; render();
    message(`已将当前 PCB 的 ${rules.length} 个网络颜色保存为“${name}”，并设为当前配置。未修改 PCB。`);
  });
  $('color').oninput = () => { $('hex').value = $('color').value.toUpperCase(); };
  $('hex').oninput = () => { if (/^#[\da-f]{6}$/i.test($('hex').value)) { $('default-color').checked = false; updatePreview(); } };
  $('net').onchange = colorForNet;
  $('choices').onchange = () => { if ($('choices').value) choose($('choices').value); };
  $('pick').onclick = enableCanvasPick;
  // Pause canvas updates while editing a typed rule, until the user chooses to pick again.
  $('net').onfocus = () => { picking = false; filterSession?.restore(); };
  $('refresh').onclick = () => run(async () => { await refreshNets(); message('已刷新当前 PCB 网络列表。'); });
  $('save').onclick = () => run(async () => {
    const net = $('net').value;
    const color = $('hex').value.trim().toUpperCase();
    if (!net.trim()) throw new Error('请先选择或输入网络名。');
    const useDefault = $('default-color').checked;
    const alpha = Number($('alpha').value);
    if (!useDefault && (!/^#[\da-f]{6}$/i.test(color) || !Number.isFinite(alpha) || alpha < 0 || alpha > 1)) throw new Error('颜色必须是 #RRGGBB，不透明度为 0～1。');
    const next = readConfig(eda); next.rules = next.rules.filter(rule => rule.net !== net); next.rules.push({ net, color: useDefault ? null : color, ...(!useDefault && alpha !== 1 ? { alpha } : {}) });
    await requestApply(next); picking = true;
  });
  $('apply').onclick = () => run(() => requestApply(readConfig(eda)));
  $('enabled').onchange = () => run(async () => {
    const next = readConfig(eda); next.enabled = $('enabled').checked; next.request = null;
    try { config = await writeConfig(eda, next); } finally { config = readConfig(eda); render(); }
    message(config.enabled ? '自动配色已开启，关闭窗口后仍生效。' : '自动配色已暂停；保存或手动套用仍可给当前 PCB 刷色。');
  });
  $('export').onclick = () => { const next = readConfig(eda); delete next.request; $('backup').value = JSON.stringify(next, null, 2); message('已导出，请复制文本保存。'); };
  $('import').onclick = () => run(async () => {
    const incoming = normalizeConfig(JSON.parse($('backup').value));
    let next = readConfig(eda);
    const active = next.activeProfileId;
    for (const profile of incoming.profiles) {
      const existing = next.profiles.find(item => item.name === profile.name);
      const rules = new Map((existing?.rules || []).map(rule => [rule.net, rule]));
      for (const rule of profile.rules) rules.set(rule.net, rule);
      next = saveProfile(next, profile.name, [...rules.values()], true);
    }
    await requestApply(switchProfile(next, active));
  });
  await refreshNets();
  try {
    eda.pcb_Event.removeEventListener(LISTENER);
    eda.pcb_Event.addMouseEventListener(LISTENER, 'all', (event, props) => { void pick(event, props).catch(fail); }, false);
    if (!eda.pcb_Event.isEventListenerAlreadyExist(LISTENER)) throw new Error('画布监听注册失败');
    enableCanvasPick();
  } catch (error) { message(`画布选取暂不可用：${error.message}。仍可输入网络名设置配色。`, true); }
}
const timer = setInterval(() => { void poll(); }, 1000);
function dispose() { filterSession?.restore(); disposed = true; selectionEpoch += 1; clearInterval(timer); try { eda.pcb_Event.removeEventListener(LISTENER); } catch {} }
window.addEventListener('pagehide', dispose);
window.addEventListener('beforeunload', dispose);
void start().catch(fail);
