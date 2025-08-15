// ==UserScript==
// @name         Figma Copy Text Enhancer
// @namespace    https://nick-helper.example
// @version      0.2.0
// @description  Inject a second "Text content (enriched)" panel with proper typography and a Copy button
// @author       bridgerosepetal
// @match        https://www.figma.com/*
// @match        https://*.figma.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  'use strict';

  // -----------------------------
  // Configuration
  // -----------------------------
  const CFG = {
    debug: false,
    // Where to place the extra panel: 'after' or 'before' the original one.
    insertPosition: 'after',
    // Copy mode: 'html' (entities) by default; hold Shift to copy 'unicode'
    defaultCopyMode: 'html',
  };

  // -----------------------------
  // Boot
  // -----------------------------
  const log = (...a) => CFG.debug && console.log('[EnrichedPanel]', ...a);
  const warn = (...a) => CFG.debug && console.warn('[EnrichedPanel]', ...a);

  const observer = new MutationObserver(() => {
    tryInjectOrUpdate();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Run once on start and on focus changes (Figma swaps panels async)
  tryInjectOrUpdate();
  window.addEventListener('focus', tryInjectOrUpdate, { passive: true });

  // -----------------------------
  // Core: find original, inject clone, keep updated
  // -----------------------------
  function tryInjectOrUpdate() {
    const rawEl = document.querySelector('[data-testid="textContent"]');
    if (!rawEl) return;

    const panelRoot = findPanelRoot(rawEl);
    if (!panelRoot) return;

    // Ensure one enriched panel sibling
    let enriched = panelRoot.parentElement.querySelector(
      ':scope > [data-enriched-panel="true"]'
    );
    if (!enriched) {
      enriched = clonePanel(panelRoot);
      if (!enriched) return;

      if (CFG.insertPosition === 'before') {
        panelRoot.parentElement.insertBefore(enriched, panelRoot);
      } else {
        panelRoot.parentElement.insertBefore(enriched, panelRoot.nextSibling);
      }
    }

    updateEnrichedContent(enriched, rawEl.innerText || rawEl.textContent || '');
  }

  // Heuristic: the panel root is the closest ancestor that contains
  // a title row and the content row. We look for the ancestor that has
  // a sibling title element (h3) and includes our raw element inside.
  function findPanelRoot(rawEl) {
    // Outer container with a title sibling before the content container
    let node = rawEl;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      const titleSibling = node.previousElementSibling;
      if (!titleSibling) continue;
      const hasH3 = !!titleSibling.querySelector('h3');
      if (hasH3) {
        // Likely structure: [root] -> [title row] + [content row (contains rawEl)]
        return node.parentElement || node;
      }
    }
    return null;
  }

  function clonePanel(panelRoot) {
    try {
      // We clone the whole root, then tweak title, copy button, and content block.
      const clone = panelRoot.cloneNode(true);
      clone.setAttribute('data-enriched-panel', 'true');

      // Title row
      const h3 = clone.querySelector('h3');
      if (h3) h3.textContent = 'Text content (enriched)';

      // Replace original copy button with our own
      const copyBtnHolder = clone.querySelector(
        '[data-tooltip="Copy"], button[aria-label="Copy"]'
      )?.parentElement;
      if (copyBtnHolder) {
        copyBtnHolder.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-tooltip', 'Copy (HTML entities, Shift: Unicode)');
        btn.setAttribute('aria-label', 'Copy enriched');
        btn.className =
          (copyBtnHolder.previousElementSibling?.className || '')
            .split(' ')
            .slice(0, 1)
            .join(' ') || 'button-reset__buttonReset__zO1D7';
        btn.style.cursor = 'pointer';
        btn.style.padding = '0';

        // Use a simple copy icon (fallback if Figma icon classes change)
        btn.innerHTML =
          '<span aria-hidden="true"><svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="var(--color-icon)" fill-rule="evenodd" d="M10 6h4v1h-4zM9 6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1 2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2m0 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1 1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1m1 3.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5m.5 2.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z" clip-rule="evenodd"></path></svg></span>';
        btn.addEventListener('click', (e) => {
          const mode = e.shiftKey ? 'unicode' : CFG.defaultCopyMode;
          const textNode = clone.querySelector('[data-testid="textContent"]');
          if (!textNode) return;
          const txt = textNode.innerText || textNode.textContent || '';
          const processed =
            mode === 'unicode'
              ? typographUnicode(txt)
              : typographToHtmlEntities(txt);
          copyToClipboard(processed);
        });
        copyBtnHolder.appendChild(btn);
      }

      // Content node
      let content = clone.querySelector('[data-testid="textContent"]');
      if (!content) {
        // If the selector failed, make a fallback content div inside the content row
        const contentRow = clone.querySelector('div');
        content = document.createElement('div');
        content.setAttribute('data-testid', 'textContent');
        content.style.whiteSpace = 'pre-wrap';
        contentRow?.appendChild(content);
      }
      // Mark so we can identify in updates
      content.setAttribute('data-enriched-content', 'true');

      // Make it clear this field is read-only enriched preview
      content.setAttribute('title', 'Enriched preview (auto-updated)');

      return clone;
    } catch (e) {
      warn('clonePanel failed', e);
      return null;
    }
  }

  function updateEnrichedContent(enrichedPanel, rawText) {
    const target = enrichedPanel.querySelector('[data-enriched-content="true"]');
    if (!target) return;

    // Default view in the panel: show HTML-entities text, because that’s what
    // you usually want to paste into markup from Inspect.
    const htmlEntityStr = typographToHtmlEntities(rawText);

    // Visually keep the “well” layout the same
    target.style.whiteSpace = 'pre-wrap';
    target.textContent = htmlEntityStr;
  }

  async function copyToClipboard(text) {
    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {
      // fall through
    }
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, { type: 'text', mimetype: 'text/plain' });
        return;
      }
    } catch {}
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {}
    document.body.removeChild(ta);
  }

  // -----------------------------
  // Typography rules
  // -----------------------------

  // Public helpers
  function typographToHtmlEntities(s) {
    const u = typographUnicode(s);
    return toHtmlEntities(u);
  }

  function typographUnicode(input) {
    if (!input) return input;

    let s = String(input);

    // Normalize line endings
    s = s.replace(/\r\n/g, '\n');

    const hasCyr = /[\u0400-\u04FF]/.test(s);

    // Convert ASCII quotes to smart quotes (ru/en)
    s = smartQuotes(s, hasCyr ? 'ru' : 'en');

    // Replace (c) (r) (tm), +/- variations
    s = s.replace(/\(\s*[cс]\s*\)/gi, '©');
    s = s.replace(/\(\s*r\s*\)/gi, '®');
    s = s.replace(/\(\s*tm\s*\)/gi, '™');
    s = s.replace(/\+\s*\/\s*-\b|\+\s*-\b/gi, '±');

    // Em dash: space - space → — with NBSP before, normal space after
    s = s.replace(/(\S)\s*-\s+(\S)/g, (_, a, b) => `${a} — ${b}`);
    // Ensure only NBSP before em dash; collapse extra spaces after
    s = s.replace(/\s+—\s*/g, ' — ');

    // Apostrophes within words → ’
    s = s.replace(/(\p{L})'(?=\p{L})/gu, '$1’');

    // NBSP bindings for Russian short words (prepositions/conjunctions)
    if (hasCyr) {
      // Bind common prepositions/conjunctions (1–2 letters) to next word
      const preps =
        'в|к|с|у|о|и|а|но|на|по|за|из|от|до|со|ко|об|обо|во|для|без|при|над|под|про';
      s = s.replace(
        new RegExp(`(^|[\\s([«„])((?:${preps}))\\s+(?=\\S)`, 'giu'),
        (_, pfx, w) => `${pfx}${w} `
      );

      // Particles bound to previous word: же, ли, ль, бы, б
      s = s.replace(
        /(\S)\s+(же|ли|ль|бы|б)(?=[\s.,;:!?)]|$)/giu,
        '$1 $2'
      );

      // Years: 2025 г.
      s = s.replace(/(\d{3,4})\s+г\./giu, '$1 г.');

      // Section sign/number sign spacing
      s = s.replace(/§\s*(\d)/g, '§ $1');
      s = s.replace(/№\s*(\d)/g, '№ $1');
      // Convert No./Nо. → № in Cyrillic context
      s = s.replace(/\bN[оo]\.?\s*(\d)/gi, '№ $1');
    }

    // Numbers with group spacing → use NBSP between groups
    s = s.replace(
      /\b(\d{1,3}(?:[ \u00A0]\d{3})+)(?![\d])/g,
      (m) => m.replace(/[ \u00A0]/g, '\u00A0')
    );

    // NBSP between number and currency
    s = s.replace(/(\d)\s*([₽€£$])\b/g, '$1 $2');

    // Degrees with unit (keep NBSP between number and °X)
    s = s.replace(
      /(\d)\s*(?:°|º|deg)\s*([cCfF])/g,
      (_, d, t) => `${d} °${t.toUpperCase()}`
    );
    // Tighten ±number
    s = s.replace(/±\s+(\d)/g, '±$1');

    return s;
  }

  // Convert selected special chars to HTML entities.
  // We intentionally convert a minimal set used in your examples.
  function toHtmlEntities(s) {
    const map = new Map([
      ['\u00A0', '&nbsp;'], // NBSP
      ['\u2014', '&mdash;'], // —
      ['\u2013', '&ndash;'], // –
      ['\u00AB', '&laquo;'], // «
      ['\u00BB', '&raquo;'], // »
      ['\u201E', '&#132;'], // „ (no widely-used named HTML4 entity)
      ['\u201C', '&#147;'], // “
      ['\u201D', '&#148;'], // ”
      ['\u2019', '&#146;'], // ’
    ]);
    let out = '';
    for (const ch of s) {
      out += map.get(ch) || ch;
    }
    return out;
  }

  // Smart quotes similar to earlier version, simplified
  function smartQuotes(text, lang) {
    const openMap = {
      ru: ['«', '„'],
      en: ['“', '‘'],
    };
    const closeMap = {
      ru: ['»', '“'],
      en: ['”', '’'],
    };

    const prevNonSpace = (s, i) => {
      for (let j = i - 1; j >= 0; j--) {
        const c = s[j];
        if (!/\s/.test(c)) return c;
      }
      return '';
    };
    const nextNonSpace = (s, i) => {
      for (let j = i + 1; j < s.length; j++) {
        const c = s[j];
        if (!/\s/.test(c)) return c;
      }
      return '';
    };

    const isOpenHeuristic = (s, i) => {
      const prev = prevNonSpace(s, i);
      const next = nextNonSpace(s, i);
      if (!prev) return true;
      if (!next) return false;
      if (/[\s([{<«„—]/.test(prev)) return true;
      if (/[\s)\]}>.,!?:;»”]/.test(next)) return false;
      return !/\p{L}|\p{N}/u.test(prev);
    };

    let res = '';
    let doubleDepth = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === '"') {
        const open = isOpenHeuristic(text, i);
        if (open) {
          const idx = doubleDepth === 0 ? 0 : 1;
          res += openMap[lang][idx];
          doubleDepth++;
        } else {
          const idx = doubleDepth > 1 ? 1 : 0;
          res += closeMap[lang][idx];
          if (doubleDepth > 0) doubleDepth--;
        }
        continue;
      }

      if (ch === "'") {
        const prev = text[i - 1] || '';
        const next = text[i + 1] || '';
        if (/\p{L}/u.test(prev) && /\p{L}/u.test(next)) {
          res += '’';
        } else {
          const open = isOpenHeuristic(text, i);
          if (lang === 'ru') {
            res += open ? '„' : '“';
          } else {
            res += open ? '‘' : '’';
          }
        }
        continue;
      }

      res += ch;
    }

    return res;
  }
})();
