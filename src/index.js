import { createService } from './core.mjs';

const WINDOW = 'pcbNetColorBrushPanel';
const TIMER = 'pcb-net-color-brush-auto';
const TABS = 'pcb-net-color-brush-tabs';
let service;
let opened = false;
let lastError = '';
function report(error) {
  const message = String(error.message || error);
  if (message !== lastError) {
    lastError = message;
    eda.sys_Message.showToastMessage(`PCB网络刷色：${message}`, 'error', 6);
  }
}
export function activate() {
  service?.dispose();
  service = createService(eda);
  eda.dmt_Event.removeEventListener(TABS);
  eda.dmt_Event.addEditorTabEventListener(TABS, 'all', () => {
    service.invalidate();
    void service.tick().catch(report);
  }, false);
  if (!eda.sys_Timer.setIntervalTimer(TIMER, 2000, () => { void service.tick().catch(report); })) {
    report(new Error('后台配色定时器启动失败，请重新启用扩展。'));
  }
  void service.tick().catch(report);
}
export function deactivate() {
  service?.dispose();
  eda.sys_Timer.clearIntervalTimer(TIMER);
  eda.dmt_Event.removeEventListener(TABS);
  opened = false;
  void eda.sys_IFrame.closeIFrame(WINDOW).catch(() => {});
}
export async function openPanel() {
  if (!service) activate();
  try {
    if (opened && await eda.sys_IFrame.showIFrame(WINDOW)) return;
    opened = true;
    // Never await openIFrame: some hosts resolve it only when the window closes.
    const size = await eda.sys_Window?.getViewportSize?.();
    const position = size?.width > 0 && size?.height > 0
      ? { x: Math.max(0, size.width - 328 - 420), y: Math.max(0, Math.min(136, size.height - 560 - 32)) } : {};
    void eda.sys_IFrame.openIFrame('/iframe/index.html', 420, 560, WINDOW, {
      ...position,
      title: 'PCB网络刷色', grayscaleMask: false, minimizeButton: true, minimizeStyle: 'constricted',
      onBeforeCloseCallFn: () => { opened = false; return true; },
    }).then(ok => { if (!ok && opened) { opened = false; report(new Error('窗口打开失败')); } })
      .catch(error => { opened = false; report(error); });
  } catch (error) { opened = false; report(error); }
}
export async function applyNow() {
  if (!service) activate();
  try {
    const result = await service.tick(true);
    if (result.errors?.length) throw new Error(result.errors.join('\n'));
    const message = result.idle ? '请先打开一个 PCB。' : result.busy || result.cancelled
      ? '正在处理或文档已切换，请稍后重试。' : `已套用配色，更新 ${result.changed || 0} 个网络。`;
    eda.sys_Message.showToastMessage(message, 'info', 4);
  } catch (error) { report(error); }
}
