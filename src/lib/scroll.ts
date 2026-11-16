// The content owns its scroll position so wheel, touch and keyboard keep working.
for (const frame of document.querySelectorAll<HTMLElement>(".scroll-frame")) {
  const viewport = frame.firstElementChild as HTMLElement;
  const vertical = frame.querySelector<HTMLInputElement>(".scroll-y")!;
  const horizontal = frame.querySelector<HTMLInputElement>(".scroll-x")!;
  frame.classList.add("enhanced");

  let previousTop = 0;
  let previousLeft = 0;
  function sync() {
    const top = Math.round(viewport.scrollTop);
    const left = Math.round(viewport.scrollLeft);
    if (top !== previousTop)
      vertical.toggleAttribute("data-reverse", top < previousTop);
    if (left !== previousLeft)
      horizontal.toggleAttribute("data-reverse", left < previousLeft);
    previousTop = top;
    previousLeft = left;
    vertical.value = String(top);
    horizontal.value = String(left);
  }
  function measure() {
    const { scrollTop, scrollLeft } = viewport;
    // Start at full size so the previous gutter can't wrap a line and keep itself visible.
    frame.dataset.measuring = "xy";
    const hasArea = viewport.clientWidth > 0 && viewport.clientHeight > 0;
    let needsY = hasArea && viewport.scrollHeight > viewport.clientHeight;
    let needsX = hasArea && viewport.scrollWidth > viewport.clientWidth;
    // A necessary track can make the other axis overflow too.
    if (needsY && !needsX) {
      vertical.hidden = false;
      frame.dataset.measuring = "x";
      needsX = viewport.scrollWidth > viewport.clientWidth;
    } else if (needsX && !needsY) {
      horizontal.hidden = false;
      frame.dataset.measuring = "y";
      needsY = viewport.scrollHeight > viewport.clientHeight;
    }
    vertical.hidden = !needsY;
    horizontal.hidden = !needsX;
    delete frame.dataset.measuring;
    vertical.max = String(viewport.scrollHeight - viewport.clientHeight);
    horizontal.max = String(viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollTo(scrollLeft, scrollTop);
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
