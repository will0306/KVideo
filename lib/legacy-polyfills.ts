/**
 * Runtime polyfills for old TV WebViews (Android 9 / Amlogic boxes ship Chrome 66–74).
 * Next.js only serves its polyfill bundle to browsers without ES module support, so
 * Chrome 61+ gets none. Inlined first in <head> so it runs before any app chunk.
 * Written in ES5: this string is not transpiled. Some polyfills are partial (noted inline):
 * they cover how this app and its dependencies call them, not the full spec.
 */
export const LEGACY_POLYFILLS_SCRIPT = `(function () {
  function define(target, name, value) {
    if (!(name in target)) {
      Object.defineProperty(target, name, { value: value, writable: true, configurable: true });
    }
  }

  if (typeof globalThis === 'undefined') {
    define(window, 'globalThis', window);
  }

  define(window, 'queueMicrotask', function (callback) {
    Promise.resolve().then(callback).catch(function (error) {
      setTimeout(function () { throw error; });
    });
  });

  define(Object, 'fromEntries', function (entries) {
    var result = {};
    Array.from(entries, function (entry) { result[entry[0]] = entry[1]; });
    return result;
  });

  define(Object, 'hasOwn', function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  });

  function flatten(source, depth, output) {
    for (var i = 0; i < source.length; i++) {
      if (!(i in source)) continue;
      if (depth > 0 && Array.isArray(source[i])) {
        flatten(source[i], depth - 1, output);
      } else {
        output.push(source[i]);
      }
    }
    return output;
  }

  define(Array.prototype, 'flat', function (depth) {
    return flatten(this, depth === undefined ? 1 : Number(depth), []);
  });

  define(Array.prototype, 'flatMap', function (callback, thisArg) {
    return flatten(Array.prototype.map.call(this, callback, thisArg), 1, []);
  });

  function at(index) {
    var length = this.length;
    var relative = Math.trunc(index) || 0;
    var k = relative >= 0 ? relative : length + relative;
    return k < 0 || k >= length ? undefined : this[k];
  }
  define(Array.prototype, 'at', at);
  define(String.prototype, 'at', function (index) {
    return at.call(String(this), index);
  });

  define(Array.prototype, 'findLast', function (callback, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (callback.call(thisArg, this[i], i, this)) return this[i];
    }
    return undefined;
  });

  define(Array.prototype, 'findLastIndex', function (callback, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (callback.call(thisArg, this[i], i, this)) return i;
    }
    return -1;
  });

  // Partial: no $& / $1 replacement patterns
  define(String.prototype, 'replaceAll', function (search, replacement) {
    if (search instanceof RegExp) return this.replace(search, replacement);
    return String(this).split(String(search)).join(
      typeof replacement === 'function' ? replacement(String(search)) : replacement
    );
  });

  define(Promise, 'allSettled', function (promises) {
    return Promise.all(Array.from(promises, function (promise) {
      return Promise.resolve(promise).then(
        function (value) { return { status: 'fulfilled', value: value }; },
        function (reason) { return { status: 'rejected', reason: reason }; }
      );
    }));
  });

  // Partial: a plain Error, not a subclassable constructor
  if (typeof AggregateError === 'undefined') {
    var AggregateErrorPolyfill = function (errors, message) {
      var error = new Error(message);
      error.name = 'AggregateError';
      error.errors = Array.from(errors);
      return error;
    };
    define(window, 'AggregateError', AggregateErrorPolyfill);
  }

  define(Promise, 'any', function (promises) {
    var list = Array.from(promises);
    return new Promise(function (resolve, reject) {
      var errors = [];
      var pending = list.length;
      if (pending === 0) reject(new AggregateError([], 'All promises were rejected'));
      list.forEach(function (promise, index) {
        Promise.resolve(promise).then(resolve, function (reason) {
          errors[index] = reason;
          if (--pending === 0) reject(new AggregateError(errors, 'All promises were rejected'));
        });
      });
    });
  });

  // Partial: covers plain data (JSON-like objects, arrays, Date, Map, Set); no transfer option
  function clone(value, seen) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    var copy;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (value instanceof Map) {
      copy = new Map();
      seen.set(value, copy);
      value.forEach(function (item, key) { copy.set(clone(key, seen), clone(item, seen)); });
      return copy;
    }
    if (value instanceof Set) {
      copy = new Set();
      seen.set(value, copy);
      value.forEach(function (item) { copy.add(clone(item, seen)); });
      return copy;
    }
    copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    Object.keys(value).forEach(function (key) { copy[key] = clone(value[key], seen); });
    return copy;
  }
  define(window, 'structuredClone', function (value) {
    return clone(value, new Map());
  });

  // hls.js aligns the timeline to the first video PTS, so B-frame streams start with a slightly
  // negative DTS, which old Chrome's MSE rejects ("negative DTS after applying timestampOffset").
  // Shift every SourceBuffer forward a little; the getter hides it so hls.js sees its own values.
  var chromeVersion = parseInt((navigator.userAgent.match(/Chrome\\/(\\d+)/) || [])[1], 10);
  var timestampOffset = window.SourceBuffer &&
    Object.getOwnPropertyDescriptor(SourceBuffer.prototype, 'timestampOffset');
  if (chromeVersion < 80 && timestampOffset && timestampOffset.get && timestampOffset.set) {
    // Covers 3–4 reordered B-frames at 25–30 fps while staying under hls.js's 0.2s buffer padding.
    // Players with a smaller maxBufferHole read it from window.__kvideoDtsShift.
    var DTS_SHIFT_SECONDS = 0.15;
    window.__kvideoDtsShift = DTS_SHIFT_SECONDS;
    Object.defineProperty(SourceBuffer.prototype, 'timestampOffset', {
      configurable: true,
      enumerable: timestampOffset.enumerable,
      get: function () { return timestampOffset.get.call(this) - DTS_SHIFT_SECONDS; },
      set: function (value) { timestampOffset.set.call(this, value + DTS_SHIFT_SECONDS); },
    });
  }

  var root = document.documentElement;

  // Enables the :where()-free rule copies from scripts/postcss-legacy-webview.cjs
  try {
    document.querySelector(':where(html)');
  } catch (error) {
    root.classList.add('legacy-css');
  }

  // Flexbox gap (Chrome 84+): emulate it with margins on the flex items
  var probe = document.createElement('div');
  // Large gap and a loose check: at low page zoom a 1px gap can round to 0 or 2 device pixels
  probe.style.cssText = 'display:flex;flex-direction:column;row-gap:10px;position:absolute;visibility:hidden';
  probe.appendChild(document.createElement('div'));
  probe.appendChild(document.createElement('div'));
  root.appendChild(probe);
  var supportsFlexGap = probe.scrollHeight > 0;
  root.removeChild(probe);
  if (supportsFlexGap) return;

  // Tailwind gap utilities plus the custom-CSS flex containers that set gap
  var GAP_CONTAINER_SELECTOR = '[class*="gap-"], .next-episode-loading, .player-menu-glass .menu-item, ' +
    '.search-history-list, .search-history-item';
  // Per item: the margins the shim set, e.g. { marginLeft: '12px' }
  var GAP_MARGINS = '__kvideoGapMargins';

  function isFlowItem(element) {
    var style = getComputedStyle(element);
    return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed';
  }

  // Items keep margins of their own (ml-auto, ...): a side is only claimed while its margin is 0.
  // Claimed sides stay claimed, since a transition can make our own margin read as non-zero.
  function claimMargin(item, owned, wanted, side, size) {
    if (!size || (!(side in owned) && parseFloat(getComputedStyle(item)[side]) !== 0)) return;
    wanted[side] = size + 'px';
  }

  function setMargins(item, wanted) {
    var owned = item[GAP_MARGINS] || {};
    Object.keys(owned).forEach(function (side) {
      if (!(side in wanted)) item.style[side] = '';
    });
    Object.keys(wanted).forEach(function (side) {
      if (owned[side] !== wanted[side]) item.style[side] = wanted[side];
    });
    item[GAP_MARGINS] = wanted;
  }

  function applyFlexGap(container) {
    var style = getComputedStyle(container);
    var isFlex = style.display === 'flex' || style.display === 'inline-flex';
    var items = [];
    Array.prototype.forEach.call(container.children, function (item) {
      if (isFlex && isFlowItem(item)) {
        items.push(item);
      } else if (item[GAP_MARGINS]) {
        setMargins(item, {});
      }
    });
    if (items.length === 0) return;

    var columnGap = parseFloat(style.columnGap) || 0;
    var rowGap = parseFloat(style.rowGap) || 0;
    var direction = style.flexDirection;
    var isColumn = direction.indexOf('column') === 0;
    var isReverse = direction.indexOf('reverse') !== -1;
    var mainSide = isColumn ? (isReverse ? 'marginBottom' : 'marginTop') : (isReverse ? 'marginRight' : 'marginLeft');
    var ownedByItem = items.map(function (item) { return item[GAP_MARGINS] || {}; });
    var wantedByItem = items.map(function (item, index) {
      var wanted = {};
      if (index > 0) claimMargin(item, ownedByItem[index], wanted, mainSide, isColumn ? rowGap : columnGap);
      setMargins(item, wanted);
      return wanted;
    });

    // Wrapped rows: an item starting below everything on the current line opens a new line.
    // Line starts lose the column gap; items on later lines get the row gap above them.
    if (isColumn || style.flexWrap === 'nowrap') return;
    var lineBottom = items[0].getBoundingClientRect().bottom;
    var isLaterLine = false;
    for (var i = 1; i < items.length; i++) {
      var rect = items[i].getBoundingClientRect();
      if (rect.top >= lineBottom - 0.5) {
        isLaterLine = true;
        lineBottom = rect.bottom;
        delete wantedByItem[i][mainSide];
      } else {
        lineBottom = Math.max(lineBottom, rect.bottom);
      }
      if (isLaterLine) claimMargin(items[i], ownedByItem[i], wantedByItem[i], 'marginTop', rowGap);
      setMargins(items[i], wantedByItem[i]);
    }
  }

  // Containers to update on the next pass; a full scan covers resize/load and large subtree changes
  var pending = [];
  var fullScan = true;
  var scheduled = false;

  function queueContainer(element) {
    if (element && element.nodeType === 1 && element.matches(GAP_CONTAINER_SELECTOR) && pending.indexOf(element) === -1) {
      pending.push(element);
    }
  }

  function queueSubtree(element) {
    if (!element || element.nodeType !== 1) return;
    queueContainer(element);
    Array.prototype.forEach.call(element.querySelectorAll(GAP_CONTAINER_SELECTOR), queueContainer);
  }

  function runFlexGap() {
    scheduled = false;
    var containers = fullScan ? document.querySelectorAll(GAP_CONTAINER_SELECTOR) : pending;
    fullScan = false;
    pending = [];
    Array.prototype.forEach.call(containers, function (container) {
      if (root.contains(container)) applyFlexGap(container);
    });
    // Drop the style mutations our own margin writes just queued
    observer.takeRecords();
  }

  function scheduleFlexGap(scanAll) {
    if (scanAll === true) fullScan = true;
    if (scheduled) return;
    scheduled = true;
    setTimeout(runFlexGap, 50);
  }

  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      var target = record.target;
      if (record.type === 'childList') {
        queueContainer(target);
        Array.prototype.forEach.call(record.addedNodes, queueSubtree);
      } else if (record.attributeName === 'style') {
        // Inline styles change constantly (progress bars, animations): only the element and its container matter
        queueContainer(target);
        queueContainer(target.parentElement);
      } else {
        // class / hidden can change display or gap anywhere below (e.g. body.tv-mode)
        queueSubtree(target);
        queueContainer(target.parentElement);
      }
    });
    if (pending.length > 0) scheduleFlexGap();
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });
  function scheduleFullScan() { scheduleFlexGap(true); }
  window.addEventListener('resize', scheduleFullScan);
  window.addEventListener('load', scheduleFullScan);
  document.addEventListener('DOMContentLoaded', scheduleFullScan);
})();`;
