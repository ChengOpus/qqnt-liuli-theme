// Adapted from qqnt-liuli-theme @ dda858b7.
(() => {
  const ROLE_KEY = "liuli-color-roles";
  const CONTAINERS = [
    ["primary", "主色"],
    ["secondary", "次色"],
    ["tertiary", "第三色"],
  ];
  const ROLE_SLOTS = [
    {
      key: "accent",
      label: "强调色",
      def: "primary",
      hint: "链接、按钮、@ 提及、开关等用的颜色。",
      options: CONTAINERS,
    },
    {
      key: "selected",
      label: "选中项",
      def: "primary",
      hint: "会话列表、侧边栏、分段按钮里「当前选中」那一项的底色。",
      options: CONTAINERS,
    },
    {
      key: "self",
      label: "自己的气泡",
      def: "primary",
      hint: "主色 / 次色 / 第三色是同明暗的柔和底色；实底是更鲜艳的主色；中性是和对方一样的玻璃；反相是旧版的样子（暗色主题里是浅色气泡）。",
      options: CONTAINERS.concat([
        ["solid", "实底"],
        ["surface", "中性"],
        ["inverse", "反相"],
      ]),
    },
    {
      key: "others",
      label: "对方的气泡",
      def: "surface",
      hint: "中性是半透明玻璃，壁纸会透出来；选一个颜色就是实底。",
      options: [["surface", "中性"]].concat(CONTAINERS),
    },
  ];
  function defaultRoles() {
    const o = {};
    ROLE_SLOTS.forEach((s) => {
      o[s.key] = s.def;
    });
    return o;
  }
  function loadRoles() {
    const out = defaultRoles();
    try {
      const raw = JSON.parse(localStorage.getItem(ROLE_KEY) || "{}") || {};
      ROLE_SLOTS.forEach((s) => {
        if (s.options.some((o) => o[0] === raw[s.key])) out[s.key] = raw[s.key];
      });
    } catch (e) {}
    try {
      const raw = JSON.parse(localStorage.getItem(ROLE_KEY) || "{}");
      out.custom = {};
      for (const slot of ROLE_SLOTS) {
        const value = raw.custom?.[slot.key];
        if (/^#[0-9a-f]{6}$/i.test(value || ""))
          out.custom[slot.key] = value.toLowerCase();
      }
    } catch (e) {
      out.custom = {};
    }
    return out;
  }
  function saveRoles(roles) {
    try {
      localStorage.setItem(ROLE_KEY, JSON.stringify(roles));
    } catch (e) {}
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function accentPalette(theme, roles) {
    const k = roles && roles.accent;
    return theme.palettes[
      k === "secondary" || k === "tertiary" ? k : "primary"
    ];
  }
  function containerPair(mcu, s, k) {
    const hex = (v) => mcu.hexFromArgb(v);
    const link = k === "tertiary" ? s.primary : s.tertiary;
    return [
      hex(s[k + "Container"]),
      hex(s["on" + cap(k) + "Container"]),
      hex(link),
    ];
  }
  function roleVars(mcu, theme, isDark, roles) {
    const s = isDark ? theme.schemes.dark : theme.schemes.light;
    const opp = isDark ? theme.schemes.light : theme.schemes.dark;
    const hex = (v) => mcu.hexFromArgb(v);
    const v = {};
    const sel = roles.selected || "primary";
    const sp = containerPair(
      mcu,
      s,
      sel === "secondary" || sel === "tertiary" ? sel : "primary",
    );
    v["--ll-primary-container"] = sp[0];
    v["--ll-on-primary-container"] = sp[1];
    // 会话实底选中态也要跟随「选中项」，不能固定跟随链接/按钮的强调色。
    const selectedRole =
      sel === "secondary" || sel === "tertiary" ? sel : "primary";
    v["--ll-selected"] = hex(s[selectedRole]);
    v["--ll-on-selected"] = hex(s["on" + cap(selectedRole)]);
    const rgb = (color) => {
      const value = parseInt(color.slice(1), 16);
      return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(",");
    };
    v["--ll-selected-rgb"] = rgb(v["--ll-selected"]);
    v["--ll-on-selected-rgb"] = rgb(v["--ll-on-selected"]);
    let self;
    switch (roles.self) {
      case "secondary":
      case "tertiary":
        self = containerPair(mcu, s, roles.self);
        break;
      case "solid":
        self = [hex(s.primary), hex(s.onPrimary), hex(s.onPrimary)];
        break;
      case "surface":
        self = ["var(--ll-glass-surface)", hex(s.onSurface), hex(s.primary)];
        break;
      case "inverse":
        self = [
          hex(opp.primaryContainer),
          hex(opp.onPrimaryContainer),
          hex(opp.tertiary),
        ];
        break;
      default:
        self = containerPair(mcu, s, "primary");
    }
    v["--ll-bubble-self"] = self[0];
    v["--ll-bubble-self-fg"] = self[1];
    v["--ll-bubble-self-link"] = self[2];
    if (
      roles.others === "primary" ||
      roles.others === "secondary" ||
      roles.others === "tertiary"
    ) {
      const o = containerPair(mcu, s, roles.others);
      v["--ll-bubble-other"] = o[0];
      v["--ll-bubble-other-fg"] = o[1];
      v["--ll-bubble-other-link"] = o[2];
    } else {
      v["--ll-bubble-other"] = null;
      v["--ll-bubble-other-fg"] = null;
      v["--ll-bubble-other-link"] = null;
    }
    const custom = roles.custom || {};
    const ink = hex(s.onSurface);
    const readable = (color) => {
      const rgb = [1, 3, 5]
        .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
        ? "#000000"
        : "#ffffff";
    };
    if (custom.accent) {
      const color = custom.accent,
        on = readable(color);
      Object.assign(v, {
        "--ll-brand": color,
        "--ll-brand-rgb": rgb(color),
        "--ll-on-brand": on,
        "--ll-on-brand-rgb": rgb(on),
        "--ll-brand-hover": `color-mix(in srgb, ${color} 88%, ${on})`,
        "--ll-brand-pressed": `color-mix(in srgb, ${color} 78%, ${on})`,
      });
      // Keep readable links when the chosen button color is a pale pastel.
      const palette = mcu.themeFromSourceColor(mcu.argbFromHex(color));
      v["--ll-link"] = hex(
        (isDark ? palette.schemes.dark : palette.schemes.light).primary,
      );
    }
    if (custom.selected) {
      const color = custom.selected,
        on = readable(color);
      Object.assign(v, {
        "--ll-selected": color,
        "--ll-selected-rgb": rgb(color),
        "--ll-on-selected": on,
        "--ll-on-selected-rgb": rgb(on),
        "--ll-primary-container": color,
        "--ll-on-primary-container": on,
      });
    }
    // Message tints share the same frosted base. QQ message skins override
    // these variables in bubbles.css and retain their dedicated renderer.
    v["--ll-bubble-self"] =
      roles.self === "surface" && !custom.self
        ? "var(--ll-glass-surface)"
        : `color-mix(in srgb, ${custom.self || self[0]} 14%, var(--ll-glass-surface))`;
    v["--ll-bubble-self-fg"] = ink;
    v["--ll-bubble-self-link"] = v["--ll-link"] || hex(s.primary);
    if (custom.others || v["--ll-bubble-other"]) {
      v["--ll-bubble-other"] =
        `color-mix(in srgb, ${custom.others || v["--ll-bubble-other"]} 14%, var(--ll-glass-surface))`;
      v["--ll-bubble-other-fg"] = ink;
      v["--ll-bubble-other-link"] = v["--ll-link"] || hex(s.primary);
    }
    return v;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const controls = new Set();
  function refreshControls() {
    for (const control of controls) {
      if (!control.host.isConnected) controls.delete(control);
      else control.refresh();
    }
  }
  addEventListener("storage", (event) => {
    if (event.key === ROLE_KEY) refreshControls();
  });
  function buildRoleControls(host, onChange) {
    const box = el("div", "liuli-roles");
    host.appendChild(box);
    box.appendChild(el("div", "liuli-panel__group", "界面颜色"));
    box.appendChild(
      el(
        "div",
        "liuli-field__hint",
        "点击色块打开调色盘。每个位置都可单独选色，也可恢复跟随主题或磨砂玻璃。",
      ),
    );
    const preview = el("div", "liuli-roles-preview");
    preview.append(
      el("div", "liuli-roles-bubble liuli-roles-bubble--other", "对方的消息"),
      el("div", "liuli-roles-bubble liuli-roles-bubble--self", "自己的消息"),
    );
    box.append(preview);
    let roles = loadRoles();
    const picks = {};
    const variables = {
      accent: "--ll-brand",
      selected: "--ll-selected",
      self: "--ll-bubble-self",
      others: "--ll-bubble-other",
    };
    const hints = {
      accent: "按钮、开关和强调标记。浅色的文字链接会自动使用可读色阶。",
      selected: "会话列表、导航和设置选中状态。",
      self: "消息底色与统一的磨砂玻璃混合。",
      others: "保留通透材质，颜色只作为轻柔的底色。",
    };
    function changed() {
      saveRoles(roles);
      if (onChange) onChange(roles);
      refreshControls();
    }
    ROLE_SLOTS.forEach((slot) => {
      const row = el("div", "liuli-color-role");
      row.dataset.slot = slot.key;
      const label = el("div", "liuli-color-role__label", slot.label);
      label.append(el("div", "liuli-field__hint", hints[slot.key]));
      const pick = window.LiuliColorPicker.create({
        label: slot.label,
        value: roles.custom[slot.key] || "#89b4fa",
        onChange: (hex) => {
          roles = loadRoles();
          roles.custom[slot.key] = hex;
          changed();
        },
      });
      const reset = el(
        "button",
        "liuli-color-reset",
        slot.key === "self" || slot.key === "others" ? "磨砂玻璃" : "跟随主题",
      );
      reset.type = "button";
      reset.addEventListener("click", () => {
        roles = loadRoles();
        delete roles.custom[slot.key];
        roles[slot.key] =
          slot.key === "self" || slot.key === "others" ? "surface" : "primary";
        changed();
      });
      row.append(label, pick.element, reset);
      box.append(row);
      picks[slot.key] = pick;
    });
    const control = {
      host: box,
      refresh() {
        roles = loadRoles();
        const css = getComputedStyle(document.body);
        for (const slot of ROLE_SLOTS) {
          const value =
            roles.custom[slot.key] ||
            css.getPropertyValue(variables[slot.key]).trim();
          picks[slot.key].setValue(
            window.LiuliColorPicker.toHex(
              value,
              document.body.dataset.liuliSource || "#89b4fa",
            ),
          );
        }
      },
    };
    controls.add(control);
    control.refresh();
    const reset = el("button", "liuli-color-reset", "恢复默认配色");
    reset.type = "button";
    reset.addEventListener("click", () => {
      roles = {
        ...defaultRoles(),
        self: "surface",
        others: "surface",
        custom: {},
      };
      changed();
    });
    box.append(reset);
  }
  window.LiuliRoles = {
    ROLE_KEY,
    ROLE_SLOTS,
    defaultRoles,
    loadRoles,
    saveRoles,
    accentPalette,
    roleVars,
    buildRoleControls,
    refreshControls,
  };
})();
