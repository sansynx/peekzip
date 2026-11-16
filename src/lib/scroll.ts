// The content owns its scroll position so wheel, touch and keyboard keep working.
for (const frame of document.querySelectorAll<HTMLElement>(".scroll-frame")) {
  const viewport = frame.firstElementChild as HTMLElement;
  const vertical = frame.querySelector<HTMLInputElement>(".scroll-y")!;
  const horizontal = frame.querySelector<HTMLInputElement>(".scroll-x")!;
  frame.classList.add("enhanced");

  function sync() {
    vertical.value = String(Math.round(viewport.scrollTop));
    horizontal.value = String(Math.round(viewport.scrollLeft));
  }
  function measure() {
    for (const [control, max] of [
      [vertical, viewport.scrollHeight - viewport.clientHeight],
      [horizontal, viewport.scrollWidth - viewport.clientWidth],
    ] as const) {
      control.hidden = max <= 0 || !viewport.clientHeight;
      control.max = String(Math.max(0, max));
    }
    sync();
  }
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      measure();
    });
  }
  new ResizeObserver(schedule).observe(viewport);
  new MutationObserver(schedule).observe(viewport, {
    childList: true,
    subtree: true,
  });
  viewport.addEventListener("load", schedule, true);
  document.fonts.ready.then(schedule);
  viewport.addEventListener("scroll", sync, { passive: true });
  vertical.addEventListener("input", () => {
    viewport.scrollTop = vertical.valueAsNumber;
  });
  horizontal.addEventListener("input", () => {
    viewport.scrollLeft = horizontal.valueAsNumber;
  });
  for (const control of [vertical, horizontal]) {
    control.addEventListener("keydown", (event) => {
      const isVertical = control === vertical;
      const extent = isVertical ? viewport.clientHeight : viewport.clientWidth;
      const max = Number(control.max);
      const delta = {
        ArrowUp: -32,
        ArrowLeft: -32,
        ArrowDown: 32,
        ArrowRight: 32,
        PageUp: -extent,
        PageDown: extent,
        Home: -max,
        End: max,
      }[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      if (isVertical) viewport.scrollTop += delta;
      else viewport.scrollLeft += delta;
    });
  }
  schedule();
}
