// Compatibility adapter for the inspected EDA filter panel. No editor files,
// visibility flags, locked-state filters or saved presets are modified.
export function createFilterSession(host) {
  let saved = [];
  const targets = { Pad: true, Via: true, Track: true, 'Copper Region': true, Component: false };
  function control(title) {
    const panel = host?.getElementById('pcb-filter');
    const labels = panel ? [...panel.querySelectorAll('label[data-test]')] : [];
    const label = labels.find(node => node.getAttribute('data-test') === title);
    const input = label && host.getElementById(label.htmlFor);
    if (!input || input.type !== 'checkbox' || input.disabled || !panel.contains(input)) throw new Error('无法访问 PCB 过滤项：' + title);
    return input;
  }
  function restore() {
    host?.removeEventListener('pointerdown', onHostInteraction, true);
    const failed = [];
    for (const item of [...saved].reverse()) {
      try {
        const input = control(item.title);
        if (input.checked !== item.before) input.click();
        if (control(item.title).checked !== item.before) throw new Error('恢复失败');
      } catch { failed.push(item); }
    }
    saved = failed.reverse();
    return saved.length === 0;
  }
  // Canvas events occur in its own iframe. A host click includes tab switches,
  // filter edits and close buttons: restore before their handlers run.
  function onHostInteraction() { restore(); }
  function enable() {
    if (!restore()) throw new Error('上次过滤设置未恢复，请检查过滤面板。');
    // Preflight every required checkbox before making any change.
    const before = Object.entries(targets).map(([title, wanted]) => ({ title, wanted, before: control(title).checked }));
    try {
      for (const item of before) {
        if (item.before === item.wanted) continue;
        saved.push(item);
        control(item.title).click();
        if (control(item.title).checked !== item.wanted) throw new Error('过滤项未生效：' + item.title);
      }
      host.addEventListener('pointerdown', onHostInteraction, true);
      return true;
    } catch (error) { restore(); throw error; }
  }
  return { enable, restore, get active() { return saved.length > 0; } };
}
