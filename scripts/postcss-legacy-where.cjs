'use strict';

/**
 * Old TV WebViews (Chrome < 88) drop every rule whose selector uses `:where()`: Tailwind's
 * space-*, group-hover:*, peer-*, and preflight rules like `[hidden]`. This repeats each such rule
 * without `:where()` under `html.legacy-css`, a class lib/legacy-polyfills.ts sets only when the
 * selector is unsupported, so modern browsers keep the original specificity.
 * Must run after postcss-preset-env, which first rewrites Tailwind's `:is(:where(.group):hover *)`.
 */

const LEGACY_CLASS_SELECTOR = '.legacy-css';

/** Splits a selector list on top-level commas, ignoring escapes, quotes, brackets and parens. */
function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === '\\') {
      i++;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth--;
    } else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

/** Index of the parenthesis closing the one at `open`, or -1. */
function findClosingParen(selector, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < selector.length; i++) {
    const char = selector[i];
    if (char === '\\') {
      i++;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/** True when `selector` has a descendant/child/sibling combinator outside parens and brackets. */
function hasTopLevelCombinator(selector) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === '\\') {
      i++;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth--;
    } else if (depth === 0 && /[\s>+~]/.test(char)) {
      return true;
    }
  }
  return false;
}

/** Old Chrome only accepts a single simple selector inside :not(). */
function hasSelectorListInNot(selector) {
  for (let start = selector.indexOf(':not('); start !== -1; start = selector.indexOf(':not(', start + 1)) {
    const end = findClosingParen(selector, start + ':not'.length);
    if (end !== -1 && splitTopLevel(selector.slice(start + ':not('.length, end)).length > 1) return true;
  }
  return false;
}

/**
 * `a:where(.b, .c) d` -> ['a.b d', 'a.c d']. Arguments that can't be inlined are dropped:
 * `x:where(.dark *)` would mean something else as `x.dark *`.
 */
function expandWhere(selector) {
  const start = selector.indexOf(':where(');
  if (start === -1) return hasSelectorListInNot(selector) ? [] : [selector];
  const end = findClosingParen(selector, start + ':where'.length);
  if (end === -1) return [];
  const before = selector.slice(0, start);
  const after = selector.slice(end + 1);
  const attachedToCompound = before !== '' && !/[\s>+~]$/.test(before);
  return splitTopLevel(selector.slice(start + ':where('.length, end))
    .filter(part => !(attachedToCompound && hasTopLevelCombinator(part)))
    .flatMap(part => expandWhere(before + part + after));
}

/** Scopes a selector to `html.legacy-css`, attaching the class when it already starts at the root. */
function scopeToLegacy(selector) {
  const rootMatch = selector.match(/^(html|:root)(?![\w-])/);
  if (rootMatch) return `${rootMatch[0]}${LEGACY_CLASS_SELECTOR}${selector.slice(rootMatch[0].length)}`;
  return `${LEGACY_CLASS_SELECTOR} ${selector}`;
}

function isInsideKeyframes(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true;
  }
  return false;
}

module.exports = () => ({
  postcssPlugin: 'kvideo-legacy-where',
  // OnceExit: preset-env rewrites selectors in Rule visitors, which run after every plugin's Once
  OnceExit(root) {
    const whereCopies = [];
    root.walkRules(rule => {
      if (!rule.selector.includes(':where(') || isInsideKeyframes(rule)) return;
      // Leave out GPU-layer hints like `nav:where(.fixed) { transform: translateZ(0) }`:
      // they'd override the transform fallbacks
      if (rule.some(decl => decl.type === 'decl' && decl.prop === 'transform' && !decl.value.includes('--tw-'))) return;
      const selectors = rule.selectors
        .flatMap(expandWhere)
        .map(scopeToLegacy);
      if (selectors.length > 0) whereCopies.push({ rule, copy: rule.clone({ selectors }) });
    });
    whereCopies.forEach(({ rule, copy }) => rule.after(copy));
  },
});
module.exports.postcss = true;
