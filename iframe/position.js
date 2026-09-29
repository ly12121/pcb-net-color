// Only reposition the verified ancestor of this extension's own iframe.
(() => {
  try {
    const frame = window.frameElement;
    const container = frame?.closest('[id^="iframeContainer"]');
    const id = container?.id.slice('iframeContainer'.length);
    if (!id?.includes('pcbNetColorBrushPanel')) return;
    const host = frame.ownerDocument;
    const root = host.getElementById(id);
    const box = host.getElementById(id + '_dialog_box');
    if (!box || !root?.contains(box) || !box.contains(frame)) return;
    const original = root.style.getPropertyValue('visibility');
    const priority = root.style.getPropertyPriority('visibility');
    const reveal = () => original ? root.style.setProperty('visibility', original, priority) : root.style.removeProperty('visibility');
    root.style.setProperty('visibility', 'hidden', 'important');
    const watchdog = setTimeout(reveal, 1200);
    // Inspected EDA host performs delayed centering at 200 ms.
    setTimeout(() => {
      try {
        const view = host.defaultView;
        const rect = box.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return;
        box.style.position = 'fixed';
        box.style.left = Math.max(0, view.innerWidth - 328 - rect.width) + 'px';
        box.style.top = Math.max(0, Math.min(136, view.innerHeight - rect.height - 16)) + 'px';
        for (const key of ['left', 'top', 'width', 'height']) root.style[key] = '';
        root.style.opacity = '1';
      } finally { clearTimeout(watchdog); reveal(); }
    }, 250);
  } catch { /* Unsupported hosts retain a usable, draggable window. */ }
})();
