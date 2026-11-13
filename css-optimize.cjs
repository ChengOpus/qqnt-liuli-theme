'use strict';
// Load-time CSS rewrite that changes how fast a stylesheet matches, never what
// it matches.
//
// Blink sorts rules into buckets by the rightmost compound of each selector:
// an id, a class, a tag. A selector whose rightmost compound is a bare
// `:is(.a, .b, .c)` lands in the universal bucket and is tried against every
// element in the window on every style recalculation. Many theme rules are
// written that way (`body[x] :is(.a, .b)`), and QQ's virtual list creates
// thousands of elements while scrolling.
//
// `X :is(A, B)Y` is rewritten to `X AY, X BY` when every alternative is a
// single simple compound (no combinator, no nested list) and all alternatives
// have the same specificity. With equal specificity, the same declarations
// and the same rule position, the cascade result is identical; only bucketing
// changes. Anything that does not fit is left exactly as written.

function splitTop(text, sep) {
  const parts = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && c === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
// [ids, classes/attrs/pseudo-classes, tags]
// Only called on SIMPLE compounds: [tag](.class|#id|[attr])*
function specificity(compound) {
  let s = compound;
  const attrs = (s.match(/\[[^\]]*\]/g) || []).length;
  s = s.replace(/\[[^\]]*\]/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length;
  const tag = /^[a-zA-Z]/.test(s) ? 1 : 0;
  return [ids, classes + attrs, tag].join(',');
}
const SIMPLE = /^(?:[a-zA-Z][\w-]*)?(?:[.#][\w-]+|\[[^\]]+\])+$|^[a-zA-Z][\w-]*$/;
function expandSelector(selector) {
  // rightmost compound: after the last top-level combinator
  let depth = 0, quote = '', cut = -1;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) cut = i;
  }
  const head = selector.slice(0, cut + 1);
  const last = selector.slice(cut + 1);
  if (!last.startsWith(':is(')) return [selector];
  let d = 0, end = -1;
  for (let i = 3; i < last.length; i++) {
    if (last[i] === '(') d++;
    else if (last[i] === ')' && --d === 0) { end = i; break; }
  }
  if (end < 0) return [selector];
  const args = splitTop(last.slice(4, end), ',').map(a => a.trim());
  const rest = last.slice(end + 1);
  if (args.length < 2 || !args.every(a => SIMPLE.test(a))) return [selector];
  const spec = specificity(args[0]);
  if (!args.every(a => specificity(a) === spec)) return [selector];
  return args.map(a => head + a + rest);
}
function rewritePrelude(full) {
  // Comments before the selector are kept verbatim and never parsed (they can
  // hold commas); a comment inside the selector list leaves the rule alone.
  const cut = full.lastIndexOf('*/');
  const comment = cut < 0 ? '' : full.slice(0, cut + 2);
  const prelude = cut < 0 ? full : full.slice(cut + 2);
  if (prelude.includes('/*')) return full;
  return comment + rewriteSelectors(prelude);
}
function rewriteSelectors(prelude) {
  const selectors = splitTop(prelude, ',');
  const out = [];
  let changed = false;
  for (const sel of selectors) {
    const lead = sel.match(/^\s*/)[0];
    const trimmed = sel.trim();
    const expanded = expandSelector(trimmed);
    if (expanded.length > 1) changed = true;
    for (const e of expanded) out.push(lead + e);
  }
  return changed ? out.join(',') : prelude;
}
function optimize(css) {
  let out = '', i = 0, quote = '', buf = '';
  const n = css.length;
  // walk text; for each `{` decide whether the prelude is a style rule
  let preludeStart = 0, depthStack = [];
  while (i < n) {
    const c = css[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = '';
      i++;
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '{') {
      const prelude = css.slice(preludeStart, i);
      const isStyle = !/^\s*@/.test(prelude) && depthStack[depthStack.length - 1] !== 'keyframes';
      const kind = /^\s*@(-webkit-)?keyframes/.test(prelude) ? 'keyframes' : isStyle ? 'style' : 'at';
      out += isStyle ? rewritePrelude(prelude) + '{' : prelude + '{';
      depthStack.push(kind);
      i++;
      preludeStart = i;
      continue;
    }
    if (c === '}') {
      out += css.slice(preludeStart, i + 1);
      depthStack.pop();
      i++;
      preludeStart = i;
      continue;
    }
    if (c === ';' && depthStack[depthStack.length - 1] !== 'style') {
      // statement at-rule (@import ...) or declaration inside at-rule
      out += css.slice(preludeStart, i + 1);
      i++;
      preludeStart = i;
      continue;
    }
    i++;
  }
  out += css.slice(preludeStart);
  return out;
}
module.exports = { optimize, expandSelector, specificity };
