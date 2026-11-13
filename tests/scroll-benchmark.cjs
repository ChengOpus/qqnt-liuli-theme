// Fast scrolling through a long group chat, the way QQ's virtual list does it:
// rows are created as they enter the window and destroyed as they leave, so
// every wheel step is DOM churn plus whatever the theme does about it.
//
// Reports main-thread work (CDP metrics), rAF frame intervals and long tasks
// for the same wheel sequence, per variant. Headless Chromium composites in
// software: absolute numbers do not transfer to the Windows client, the
// comparison between variants does.
//
//   node tests/scroll-benchmark.cjs [variant ...]
//   variants: bare | theme (default: both)
const { start } = require("./harness.cjs");

// Runs in the page before the theme boots. Replaces the fixture's short list
// with a 3000-message virtualised list in an ordinary top-to-bottom scroller.
function virtualList() {
  const area = document.querySelector('.aio[data-fixture="group"] .ml-container');
  const list = area.querySelector(".ml-list");
  const style = document.createElement("style");
  style.textContent =
    '.aio[data-fixture="group"] .ml-container{display:block!important}' +
    '.aio[data-fixture="group"] .ml-list{display:block!important;position:relative}' +
    ".ml-item{box-sizing:border-box}";
  document.head.append(style);
  const TOTAL = 3000,
    names = ["匿名甲", "匿名乙", "匿名丙", "匿名丁", "匿名戊"];
  const kind = (i) =>
    i % 17 === 0 ? "image" : i % 23 === 0 ? "file" : i % 29 === 0 ? "reply" : i % 7 === 0 ? "long" : "text";
  const height = (i) => ({ image: 220, file: 110, reply: 130, long: 150, text: 86 })[kind(i)];
  const tops = new Float64Array(TOTAL + 1);
  for (let i = 0; i < TOTAL; i++) tops[i + 1] = tops[i] + height(i);
  const sender = (i) => Math.floor(i / 3) % names.length; // runs of three
  function row(i) {
    const self = sender(i) === 0;
    const item = document.createElement("div");
    item.className = "ml-item";
    item.id = String(7000000000 + i);
    item.style.cssText = `position:absolute;left:0;right:0;top:${tops[i]}px;height:${height(i)}px`;
    let body;
    switch (kind(i)) {
      case "image":
        body = '<div class="message-content mix-message__inner"><div class="pic-element"><div class="image-content" style="width:180px;height:160px;border-radius:8px;background:#c9b8d8"></div></div></div>';
        break;
      case "file":
        body = '<div class="file-message--content"><div class="file-element"><div class="normal-file" style="background:#fff"><div class="file-info"><div class="file-name" style="color:#000">匿名文件-' + i + '.zip</div><div class="file-size" style="color:#999">1.2 MB</div></div><div class="file-icon"></div></div></div></div>';
        break;
      case "reply":
        body = '<div class="message-content"><div class="reply-element"><span class="text-normal">引用的一段匿名消息</span></div><span class="text-element"><span class="text-normal">回复 **粗体** 内容 ' + i + "</span></span></div>";
        break;
      case "long":
        body = '<div class="message-content"><span class="text-element"><span class="text-element--at">@匿名乙</span><span class="text-normal">' + "一段较长的匿名消息，用来占据多行。".repeat(4) + "</span></span></div>";
        break;
      default:
        body = '<div class="message-content"><span class="text-element"><span class="text-normal">匿名消息 ' + i + "</span></span></div>";
    }
    const side = self ? "self" : "others";
    item.innerHTML =
      '<div class="message"><div class="message-container message-container--' + side +
      '"><div class="avatar-span" aria-label="' + names[sender(i)] +
      '"></div><div class="user-name"><span class="q-tag">LV' + (i % 90) + '</span><span class="text-ellipsis">' + names[sender(i)] +
      '</span></div><div class="message-content__wrapper"><div class="msg-content-container container--' + side +
      (kind(i) === "image" ? " mix-message__container--pic" : "") + '">' + body + "</div></div></div></div>";
    return item;
  }
  list.replaceChildren();
  list.style.height = tops[TOTAL] + "px";
  const live = new Map();
  let frame = 0;
  function render() {
    frame = 0;
    const top = area.scrollTop,
      bottom = top + area.clientHeight;
    // binary search for the first row in range, with one screen of overscan
    let lo = 0,
      hi = TOTAL;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid + 1] < top - area.clientHeight) lo = mid + 1;
      else hi = mid;
    }
    const first = lo;
    let last = first;
    while (last < TOTAL && tops[last] < bottom + area.clientHeight) last++;
    for (const [i, node] of live)
      if (i < first || i >= last) {
        node.remove();
        live.delete(i);
      }
    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i++)
      if (!live.has(i)) {
        const node = row(i);
        live.set(i, node);
        fragment.append(node);
      }
    list.append(fragment);
  }
  area.addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(render);
    },
    { passive: true },
  );
  area.scrollTop = tops[TOTAL];
  render();
  window.__vlist = { area, live, render, total: tops[TOTAL] };
}

async function measure(h, variant) {
  const options = { width: 1280, height: 860, dark: false, before: virtualList };
  let page, context;
  if (variant === "bare") {
    // Same fixture and list, no theme at all.
    context = await h.browser.newContext({ viewport: { width: 1280, height: 860 } });
    page = await context.newPage();
    await page.goto(h.origin + "/?fixture=qq-native-fixture.html#/main/message");
    await page.evaluate(virtualList);
  } else {
    // "theme", "-file.css" (theme without that stylesheet), "only:file.css"
    if (variant.startsWith("css:")) variant = Object.assign(variant, {});
    const omit = variant.startsWith("-") ? variant.slice(1).split(",") : [];
    const only = variant.startsWith("only:") ? variant.slice(5).split(",") : null;
    // "nohas:file.css" — that stylesheet without its :has() rules (diagnostic)
    const nohas = variant.startsWith("nohas:") ? variant.slice(6).split(",") : null;
    const strip = (css) => {
      let out = "", depth = 0, buf = "";
      for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
        buf += ch;
        if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) {
          const head = buf.slice(0, buf.indexOf("{"));
          if (!head.includes(":has(")) out += buf;
          buf = "";
        }
      }
      return out + buf;
    };
    const settings = variant.startsWith("set:") ? JSON.parse(variant.slice(4)) : {};
    ({ page, context } = await h.open({
      ...options,
      settings,
      omit,
      assets: nohas
        ? (assets) =>
            Object.fromEntries(
              Object.entries(assets).map(([k, v]) => [k, nohas.includes(k) ? { ...v, text: strip(v.text) } : v]),
            )
        : only
        ? (assets) =>
            Object.fromEntries(
              Object.entries(assets).map(([k, v]) => [k, only.includes(k) ? v : { ...v, text: "" }]),
            )
        : null,
    }));
  }
  // "css:<rules>" — theme plus extra rules (diagnostic)
  if (typeof variant === "string" && variant.startsWith("css:"))
    await page.addStyleTag({ content: variant.slice(4) });
  await page.waitForTimeout(400);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const box = await page.evaluate(() => {
    const r = window.__vlist.area.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.evaluate(() => {
    window.__frames = [];
    window.__long = 0;
    window.__sampling = true;
    new PerformanceObserver((l) => (window.__long += l.getEntries().length)).observe({ entryTypes: ["longtask"] });
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const before = await metrics();
  let switchFrames = null;
  if (process.env.MODE === "switch") {
    // Open another conversation 12 times: the client tears the list down and
    // renders the new chat's rows in one go. Measured: the frame that shows it.
    switchFrames = [];
    for (let i = 0; i < 12; i++) {
      const ms = await page.evaluate(
        (i) =>
          new Promise((resolve) => {
            const t0 = performance.now();
            const title = document.querySelector('.aio[data-fixture="group"] .chat-header__contact-name');
            title.textContent = "匿名会话 " + i;
            window.__vlist.live.forEach((n) => n.remove());
            window.__vlist.live.clear();
            window.__vlist.area.scrollTop = window.__vlist.total - (i % 3) * 4000;
            window.__vlist.render();
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
          }),
        i,
      );
      switchFrames.push(ms);
      await page.waitForTimeout(250);
    }
  } else {
    // Fast flick up through history, then back down: 2 x 60 wheel steps.
    for (const direction of [-1, 1])
      for (let i = 0; i < 60; i++) {
        await page.mouse.wheel(0, direction * 480);
        await page.waitForTimeout(8);
      }
  }
  await page.waitForTimeout(300);
  const after = await metrics();
  const frames = await page.evaluate(() => {
    window.__sampling = false;
    const f = window.__frames.slice(2).sort((a, b) => a - b);
    return {
      frames: f.length,
      slow: f.filter((x) => x > 20).length,
      verySlow: f.filter((x) => x > 50).length,
      p95: +f[Math.floor(f.length * 0.95)].toFixed(1),
      max: +f[f.length - 1].toFixed(1),
      long: window.__long,
      rows: window.__vlist.live.size,
    };
  });
  const cpu = {};
  for (const key of ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"])
    cpu[key] = +((after[key] - before[key]) * 1000).toFixed(1);
  await context.close();
  if (switchFrames) {
    switchFrames.sort((a, b) => a - b);
    frames.switchMedian = +switchFrames[6].toFixed(1);
    frames.switchMax = +switchFrames[11].toFixed(1);
  }
  return { variant: typeof variant === "string" ? variant : variant.name, cpu, frames };
}

(async () => {
  const h = await start();
  const wanted = process.argv.slice(2);
  const variants = wanted.length ? wanted : ["bare", "theme"];
  const results = [];
  try {
    for (const name of variants) {
      const runs = [];
      for (let i = 0; i < (process.env.RUNS ? +process.env.RUNS : 3); i++) runs.push(await measure(h, name));
      const median = (pick) => runs.map(pick).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
      results.push({
        variant: name,
        taskMs: median((r) => r.cpu.TaskDuration),
        scriptMs: median((r) => r.cpu.ScriptDuration),
        layoutMs: median((r) => r.cpu.LayoutDuration),
        styleMs: median((r) => r.cpu.RecalcStyleDuration),
        slowFrames: median((r) => r.frames.slow),
        verySlowFrames: median((r) => r.frames.verySlow),
        p95: median((r) => r.frames.p95),
        longTasks: median((r) => r.frames.long),
        frames: median((r) => r.frames.frames),
        ...(process.env.MODE === "switch"
          ? { switchMs: median((r) => r.frames.switchMedian), switchMaxMs: median((r) => r.frames.switchMax) }
          : {}),
      });
      console.log(JSON.stringify(results[results.length - 1]));
    }
  } finally {
    await h.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
