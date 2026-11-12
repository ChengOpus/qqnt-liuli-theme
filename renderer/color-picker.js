/* Theme-owned picker. No native color input, network requests or global drag loop. */
(() => {
  "use strict";
  const PRESETS = [
    ["雾蓝", "#89b4fa"],
    ["长春花", "#b4befe"],
    ["薰衣草", "#cba6f7"],
    ["樱粉", "#f5c2e7"],
    ["杏桃", "#fab387"],
    ["鼠尾草", "#a6e3a1"],
  ]; // Catppuccin Mocha, https://github.com/catppuccin/palette (MIT).
  let active = null;
  const valid = (value) => /^#[0-9a-f]{6}$/i.test(value || "");
  function toHex(value, fallback = "#89b4fa") {
    if (valid(value)) return value.toLowerCase();
    const rgb = String(value).match(
      /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/,
    );
    return rgb
      ? "#" +
          rgb
            .slice(1, 4)
            .map((n) => Number(n).toString(16).padStart(2, "0"))
            .join("")
      : fallback;
  }
  function hsv(hex) {
    const [r, g, b] = [1, 3, 5].map(
      (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
    );
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      d = max - min;
    let h = !d
      ? 0
      : max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
  }
  function fromHsv({ h, s, v }) {
    const c = v * s,
      x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
      m = v - c;
    const rgb =
      h < 60
        ? [c, x, 0]
        : h < 120
          ? [x, c, 0]
          : h < 180
            ? [0, c, x]
            : h < 240
              ? [0, x, c]
              : h < 300
                ? [x, 0, c]
                : [c, 0, x];
    return (
      "#" +
      rgb
        .map((n) =>
          Math.round((n + m) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function open(anchor, value, commit, label) {
    active?.close(false);
    const panel = node("div", "liuli-picker");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", label + "调色盘");
    let state = hsv(toHex(value)),
      draft = fromHsv(state),
      closed = false;
    const title = node("div", "liuli-picker__title", label);
    const square = node("div", "liuli-picker__sv");
    square.tabIndex = 0;
    square.setAttribute("role", "slider");
    square.setAttribute("aria-label", "饱和度与明度，方向键调整");
    square.setAttribute("aria-valuemin", "0");
    square.setAttribute("aria-valuemax", "100");
    const cursor = node("span", "liuli-picker__cursor");
    square.append(cursor);
    const hue = node("input", "liuli-picker__hue");
    hue.type = "range";
    hue.min = "0";
    hue.max = "359";
    hue.step = "1";
    hue.setAttribute("aria-label", "色相");
    const fields = node("div", "liuli-picker__fields");
    const hex = node("input");
    hex.type = "text";
    hex.maxLength = 7;
    hex.setAttribute("aria-label", "HEX 颜色");
    const rgb = [0, 1, 2].map((i) => {
      const input = node("input");
      input.type = "number";
      input.min = "0";
      input.max = "255";
      input.setAttribute("aria-label", ["红色 R", "绿色 G", "蓝色 B"][i]);
      return input;
    });
    const hexLabel = node("label", "", "HEX");
    hexLabel.append(hex);
    fields.append(hexLabel);
    rgb.forEach((input, i) => {
      const lab = node("label", "", ["R", "G", "B"][i]);
      lab.append(input);
      fields.append(lab);
    });
    const presets = node("div", "liuli-picker__presets");
    PRESETS.forEach(([name, color]) => {
      const button = node("button");
      button.type = "button";
      button.title = name + " " + color;
      button.setAttribute("aria-label", name + " " + color);
      button.style.setProperty("--swatch", color);
      button.addEventListener("click", () => {
        state = hsv(color);
        draw();
      });
      presets.append(button);
    });
    const source = node("a", "liuli-picker__source", "预设 · Catppuccin");
    source.href = "https://github.com/catppuccin/palette";
    source.addEventListener("click", (e) => {
      e.preventDefault();
      window.LiuliHost?.openExternal?.(source.href);
    });
    const actions = node("div", "liuli-picker__actions");
    const cancel = node("button", "", "取消"),
      apply = node("button", "is-primary", "应用颜色");
    cancel.type = apply.type = "button";
    actions.append(cancel, apply);
    panel.append(title, square, hue, fields, presets, source, actions);
    (anchor.closest("dialog[open]") || document.body).append(panel);
    function draw() {
      draft = fromHsv(state);
      hue.value = String(Math.round(state.h));
      square.style.setProperty("--hue", String(state.h));
      cursor.style.left = state.s * 100 + "%";
      cursor.style.top = (1 - state.v) * 100 + "%";
      square.setAttribute("aria-valuenow", String(Math.round(state.s * 100)));
      square.setAttribute("aria-valuetext", draft);
      hex.value = draft;
      hex.setCustomValidity("");
      rgb.forEach(
        (n, i) =>
          (n.value = String(parseInt(draft.slice(1 + i * 2, 3 + i * 2), 16))),
      );
      apply.style.setProperty("--choice", draft);
      apply.style.setProperty(
        "--choice-fg",
        state.v > 0.7 && state.s < 0.65 ? "#20212a" : "#ffffff",
      );
    }
    function position() {
      const r = anchor.getBoundingClientRect(),
        w = Math.min(320, innerWidth - 24);
      panel.style.width = w + "px";
      panel.style.left =
        Math.max(12, Math.min(r.left, innerWidth - w - 12)) + "px";
      const height = panel.getBoundingClientRect().height;
      panel.style.top =
        Math.max(12, Math.min(r.bottom + 8, innerHeight - height - 12)) + "px";
    }
    function close(restore = true) {
      if (closed) return;
      closed = true;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keys, true);
      document.removeEventListener("focusin", outside, true);
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      panel.style.pointerEvents = "none";
      anchor.setAttribute("aria-expanded", "false");
      if (active?.panel === panel) active = null;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const anim =
        !reduced &&
        panel.animate(
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateY(-4px)" },
          ],
          { duration: 150, easing: "ease-out" },
        );
      if (anim) {
        const deadline = setTimeout(() => panel.remove(), 190);
        const remove = () => {
          clearTimeout(deadline);
          panel.remove();
        };
        anim.finished.then(remove, remove);
      } else panel.remove();
      if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
    }
    function outside(e) {
      if (!panel.contains(e.target) && !anchor.contains(e.target)) close(false);
    }
    function keys(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }
    function point(e) {
      const r = square.getBoundingClientRect();
      state.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      state.v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      draw();
    }
    square.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      square.focus();
      square.setPointerCapture(e.pointerId);
      point(e);
    });
    square.addEventListener("pointermove", (e) => {
      if (square.hasPointerCapture(e.pointerId)) point(e);
    });
    square.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      if (e.key === "ArrowLeft") state.s -= step;
      else if (e.key === "ArrowRight") state.s += step;
      else if (e.key === "ArrowUp") state.v += step;
      else if (e.key === "ArrowDown") state.v -= step;
      else return;
      e.preventDefault();
      state.s = Math.max(0, Math.min(1, state.s));
      state.v = Math.max(0, Math.min(1, state.v));
      draw();
    });
    hue.addEventListener("input", () => {
      state.h = Number(hue.value);
      draw();
    });
    hex.addEventListener("change", () => {
      if (!valid(hex.value)) {
        hex.setCustomValidity("请输入 #RRGGBB");
        hex.reportValidity();
        return;
      }
      state = hsv(hex.value);
      draw();
    });
    rgb.forEach((input) =>
      input.addEventListener("change", () => {
        if (!rgb.every((n) => n.value !== "" && n.checkValidity())) return;
        state = hsv(
          "#" +
            rgb
              .map((n) => Number(n.value).toString(16).padStart(2, "0"))
              .join(""),
        );
        draw();
      }),
    );
    cancel.addEventListener("click", () => close());
    apply.addEventListener("click", () => {
      if (!valid(hex.value)) {
        hex.reportValidity();
        return;
      }
      commit(hex.value.toLowerCase());
      close();
    });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    document.addEventListener("focusin", outside, true);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    anchor.setAttribute("aria-expanded", "true");
    active = { panel, close };
    draw();
    position();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      panel.animate(
        [
          { opacity: 0, transform: "translateY(-5px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 200, easing: "cubic-bezier(.22,1,.36,1)" },
      );
    hex.focus({ preventScroll: true });
    hex.select();
  }
  function create({ label, value, onChange }) {
    const button = node("button", "liuli-color-button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    const swatch = node("span", "liuli-color-button__swatch"),
      text = node("span");
    button.append(swatch, text);
    let current = toHex(value);
    function setValue(next) {
      current = toHex(next, current);
      text.textContent = current;
      swatch.style.background = current;
    }
    button.addEventListener("click", () => {
      if (active?.panel && button.getAttribute("aria-expanded") === "true") {
        active.close();
        return;
      }
      open(
        button,
        current,
        (color) => {
          setValue(color);
          onChange(color);
        },
        label,
      );
    });
    setValue(current);
    return { element: button, setValue };
  }
  window.LiuliColorPicker = Object.freeze({ create, toHex, PRESETS });
})();
