'use strict';

/**
 * CSS fallbacks for old Android TV WebViews (Android 9 / Amlogic boxes ship Chrome 66–74)
 * that postcss-preset-env doesn't provide. Every fallback only applies where the modern
 * feature is missing, so current browsers render exactly as before:
 * - Tailwind's @property defaults also apply where `translate` is unsupported
 * - `translate` / `scale` / `rotate` get an equivalent `transform`
 * - `aspect-ratio` gets a padding-top ratio box
 * `:where()` is handled by postcss-legacy-where.cjs, flexbox `gap` (Chrome 84+) at runtime by
 * lib/legacy-polyfills.ts since it depends on layout.
 * Must run after @tailwindcss/postcss and before postcss-preset-env, so the fallbacks get layered too.
 */

const NO_INDIVIDUAL_TRANSFORMS = 'not (translate: 0)';
const NO_ASPECT_RATIO = 'not (aspect-ratio: 1)';
const INDIVIDUAL_TRANSFORM_PROPS = new Set(['translate', 'scale', 'rotate']);
// Same order the individual properties are applied in: translate, rotate, scale
const LEGACY_TRANSFORM = 'translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) ' +
  'rotate(var(--tw-legacy-rotate, 0deg)) scale(var(--tw-scale-x, 1), var(--tw-scale-y, 1))';

/** `105%` -> `1.05`; transform scale() only takes numbers on old Chrome. */
function toScaleNumber(value) {
  const trimmed = value.trim();
  return trimmed.endsWith('%') ? String(parseFloat(trimmed) / 100) : trimmed;
}

function isInsideKeyframes(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true;
  }
  return false;
}

function supportsBlock(AtRule, condition, rule) {
  const block = new AtRule({ name: 'supports', params: condition });
  block.append(rule);
  return block;
}

/** Rule with the same selector that sets `transform` from the individual transform properties. */
function createTransformFallback(rule) {
  const fallback = rule.clone({ nodes: [] });
  rule.each(decl => {
    if (decl.type !== 'decl') return;
    if (decl.prop === '--tw-scale-x' || decl.prop === '--tw-scale-y') {
      fallback.append({ prop: decl.prop, value: toScaleNumber(decl.value) });
    } else if (decl.prop === 'scale' && !decl.value.includes('var(')) {
      const [x, y = x] = decl.value.trim().split(/\s+/);
      const none = decl.value.trim() === 'none';
      fallback.append({ prop: '--tw-scale-x', value: none ? '1' : toScaleNumber(x) });
      fallback.append({ prop: '--tw-scale-y', value: none ? '1' : toScaleNumber(y) });
    } else if (decl.prop === 'translate' && !decl.value.includes('var(')) {
      const [x, y = '0'] = decl.value.trim() === 'none' ? ['0'] : decl.value.trim().split(/\s+/);
      fallback.append({ prop: '--tw-translate-x', value: x });
      fallback.append({ prop: '--tw-translate-y', value: y });
    } else if (decl.prop === 'rotate') {
      fallback.append({ prop: '--tw-legacy-rotate', value: decl.value.trim() === 'none' ? '0deg' : decl.value });
    }
  });
  fallback.append({ prop: 'transform', value: LEGACY_TRANSFORM, important: rule.some(decl => decl.important) });
  return fallback;
}

/** Ratio box: a floated pseudo element whose percentage padding is relative to the width. */
function createAspectRatioFallback(rule, Rule, ratio) {
  const selectors = rule.selectors;
  return [
    new Rule({ selectors: selectors.map(s => `${s}::before`) }).append(
      { prop: 'content', value: '""' },
      { prop: 'float', value: 'left' },
      { prop: 'padding-top', value: `calc(100% / (${ratio}))` }
    ),
    new Rule({ selectors: selectors.map(s => `${s}::after`) }).append(
      { prop: 'content', value: '""' },
      { prop: 'display', value: 'table' },
      { prop: 'clear', value: 'both' }
    ),
  ];
}

module.exports = () => ({
  postcssPlugin: 'kvideo-legacy-webview',
  Once(root, { AtRule, Rule }) {
    // Tailwind sets its --tw-* defaults via @property, with a fallback block gated to old Safari/Firefox
    root.walkAtRules('supports', atRule => {
      if (!atRule.params.includes('margin-trim')) return;
      atRule.params = `${atRule.params} or (${NO_INDIVIDUAL_TRANSFORMS})`;
      atRule.walkRules(rule => {
        if (rule.selector.includes('*')) rule.append({ prop: '--tw-legacy-rotate', value: '0deg' });
      });
    });

    const additions = [];
    root.walkRules(rule => {
      if (isInsideKeyframes(rule)) return;
      const nodes = [];
      if (rule.some(decl => decl.type === 'decl' && INDIVIDUAL_TRANSFORM_PROPS.has(decl.prop))) {
        nodes.push(supportsBlock(AtRule, NO_INDIVIDUAL_TRANSFORMS, createTransformFallback(rule)));
      }
      const ratio = rule.nodes.find(decl => decl.type === 'decl' && decl.prop === 'aspect-ratio');
      if (ratio && ratio.value.trim() !== 'auto' && !rule.selector.includes('::')) {
        const block = new AtRule({ name: 'supports', params: NO_ASPECT_RATIO });
        block.append(createAspectRatioFallback(rule, Rule, ratio.value));
        nodes.push(block);
      }
      if (nodes.length > 0) additions.push({ rule, nodes });
    });
    additions.forEach(({ rule, nodes }) => rule.after(nodes));
  },
});
module.exports.postcss = true;
