/**
 * In-page layout checks, run with `page.evaluate(layoutIssues)`.
 * Self-contained on purpose: Playwright serialises the function, so it can't
 * use imports or helpers outside its own body.
 *
 * It reports what the owner notices on an iPad or a phone:
 *  - the page scrolls sideways;
 *  - a control (field, button, link) sticks out of its visible frame
 *    (card, rounded panel, dialog) — or out of the screen;
 *  - a box that isn't meant to scroll sideways hides content you'd have to
 *    scroll to (e.g. a dialog body wider than its panel);
 *  - text cut inside a field (a number shows "2" instead of "24", a date is
 *    cropped);
 *  - fields side by side in one row that don't line up (different top or
 *    height);
 *  - large empty holes in a grid (a short card next to a tall one, or a card
 *    stretched far beyond its content);
 *  - cards side by side in one row with a different top or height;
 *  - controls drawn over each other;
 *  - engine keys (units, zones) shown untranslated in the Arabic app.
 */
export function layoutIssues(): string[] {
  const out: string[] = [];
  const vw = document.documentElement.clientWidth;
  const TOL = 1.5;
  const HOLE_H = 120; // px of empty height worth reporting
  const HOLE_W = 220; // ... and width

  const dialog = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find((d) => d.getBoundingClientRect().width > 0) ?? null;
  // with a dialog open only its contents count (the page behind is inert)
  const root: Element = dialog ?? document.body;

  const alpha = (c: string) => {
    if (!c || c === "transparent") return 0;
    const m = c.match(/\(([^)]+)\)/);
    if (!m) return 1;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 4) return 1;
    const a = p[3];
    return a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
  };
  const shown = (e: Element) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (e.closest("[aria-hidden=true], .sr-only, [inert], [data-radix-popper-content-wrapper]")) return false;
    for (let n: Element | null = e; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) === 0) return false;
    }
    return true;
  };
  const name = (e: Element) => {
    const id = e.getAttribute("id");
    const lab = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const t =
      e.getAttribute("aria-label") ||
      lab?.textContent ||
      e.getAttribute("placeholder") ||
      (e as HTMLElement).innerText ||
      e.getAttribute("title") ||
      e.getAttribute("name") ||
      e.tagName.toLowerCase();
    return t.replace(/\s+/g, " ").trim().slice(0, 40);
  };
  const tag = (e: Element) => `<${e.tagName.toLowerCase()}${e.getAttribute("type") ? ` type=${e.getAttribute("type")}` : ""}> «${name(e)}»`;
  const isFrame = (n: Element) => {
    const role = n.getAttribute("role");
    if (role === "dialog" || role === "alertdialog") return true;
    const s = getComputedStyle(n);
    const radius = Math.max(parseFloat(s.borderTopLeftRadius) || 0, parseFloat(s.borderTopRightRadius) || 0, parseFloat(s.borderBottomLeftRadius) || 0);
    if (radius < 8) return false;
    const side = (w: string, c: string) => parseFloat(w) > 0 && alpha(c) > 0.05;
    const border = side(s.borderLeftWidth, s.borderLeftColor) || side(s.borderRightWidth, s.borderRightColor);
    const bg = alpha(s.backgroundColor) > 0.05 || s.backgroundImage !== "none";
    return border || bg || s.boxShadow !== "none";
  };
  /** a box meant to scroll sideways (tables, the schedule timeline) */
  const sideScroller = (n: Element) => {
    const s = getComputedStyle(n);
    if (!(s.overflowX === "auto" || s.overflowX === "scroll")) return false;
    const c = n.className && typeof n.className === "string" ? n.className : "";
    return /(^|\s)(overflow-x-auto|overflow-x-scroll|overflow-auto|overflow-scroll)(\s|$)/.test(c) || !!n.querySelector("table");
  };
  const fieldish = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), select, textarea";
  const controls = [...root.querySelectorAll(`${fieldish}, button, [role=button], [role=radio], [role=tab], [role=combobox], a[href]`)].filter(shown);

  // 1. sideways page scroll
  if (!dialog && document.documentElement.scrollWidth > window.innerWidth + 1) {
    out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
  }

  // 2. controls outside their frame / the screen
  for (const e of controls) {
    const r = e.getBoundingClientRect();
    let frame: Element | null = null;
    let scrolled = false;
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
      if (sideScroller(n)) {
        scrolled = true;
        break;
      }
      if (isFrame(n)) {
        frame = n;
        break;
      }
    }
    if (scrolled) continue;
    const fixed = (() => {
      for (let n: Element | null = e; n; n = n.parentElement) if (getComputedStyle(n).position === "fixed") return true;
      return false;
    })();
    if (r.left < -TOL || r.right > vw + TOL) {
      if (!fixed || dialog) out.push(`off the screen: ${tag(e)} (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
      continue;
    }
    if (!frame) continue;
    const b = frame.getBoundingClientRect();
    if (r.left < b.left - TOL || r.right > b.right + TOL) {
      const where = frame.getAttribute("role") === "dialog" ? "its dialog" : "its card";
      out.push(`sticks out of ${where}: ${tag(e)} (${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(b.left)}..${Math.round(b.right)})`);
    }
  }

  // 3. boxes that hide content sideways without being meant to scroll
  for (const n of [root, ...root.querySelectorAll("*")]) {
    if (n.matches(fieldish) || !shown(n)) continue;
    const s = getComputedStyle(n);
    if (!(s.overflowX === "auto" || s.overflowX === "scroll")) continue;
    if (sideScroller(n)) continue;
    if (n.scrollWidth > n.clientWidth + 1) out.push(`content wider than its box (hidden sideways scroll): ${n.tagName.toLowerCase()} «${name(n)}» (${n.scrollWidth} > ${n.clientWidth})`);
  }
  // the dialog panel itself must fit the screen
  if (dialog) {
    const d = dialog.getBoundingClientRect();
    if (d.left < -TOL || d.right > vw + TOL) out.push(`dialog wider than the screen (${Math.round(d.left)}..${Math.round(d.right)} of ${vw})`);
    if (d.bottom > window.innerHeight + TOL && getComputedStyle(dialog).overflowY === "visible") out.push(`dialog taller than the screen and can't scroll`);
  }

  // 4. text cut inside a field
  for (const e of controls) {
    if (!(e instanceof HTMLInputElement)) continue;
    const type = e.type;
    if (["button", "submit", "reset", "file", "checkbox", "radio", "range", "color", "image"].includes(type)) continue;
    const r = e.getBoundingClientRect();
    if (type === "date" || type === "time" || type === "datetime-local" || type === "month") {
      // the browser's own minimum width for its date text
      const probe = e.cloneNode() as HTMLInputElement;
      probe.removeAttribute("id");
      probe.style.cssText = "position:absolute;visibility:hidden;width:auto;min-width:0;max-width:none;inset-inline-start:0;top:0";
      e.parentElement!.appendChild(probe);
      const need = probe.getBoundingClientRect().width;
      probe.remove();
      if (need > r.width + 2) out.push(`date cut in its field: ${tag(e)} (needs ${Math.round(need)}px, has ${Math.round(r.width)}px)`);
      continue;
    }
    const text = e.value || e.placeholder;
    if (!text) continue;
    // numbers, short labels and short hints must show whole; a long free text may scroll inside its field
    const numeric = /^[\d\s.,٠-٩٫+\-%#XxX]+$/.test(text) || ["decimal", "numeric", "tel"].includes(e.inputMode) || type === "number" || type === "tel";
    if (!numeric && [...text].length > (e.value ? 20 : 14)) continue;
    if (e.value && e.scrollWidth > e.clientWidth + 1) {
      out.push(`text cut in its field: ${tag(e)} = "${e.value.slice(0, 20)}" (${e.scrollWidth} > ${e.clientWidth})`);
      continue;
    }
    // measure the text against the room the field really leaves for it (padding for a unit suffix included)
    const s = getComputedStyle(e);
    const c = document.createElement("canvas").getContext("2d")!;
    c.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    // (Chrome reports an input's clientWidth without its padding; use the border box)
    const room = e.getBoundingClientRect().width - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth) - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const w = c.measureText(text).width;
    if (w > room + 2) out.push(`${e.value ? "text" : "placeholder"} cut in its field: ${tag(e)} = "${text.slice(0, 20)}" (${Math.round(w)}px > ${Math.round(room)}px)`);
  }

  // 5. fields side by side that don't line up
  const fields = controls.filter((e) => e.matches(`${fieldish}, button[role=combobox]`));
  const multiColumn = (n: Element) => {
    const s = getComputedStyle(n);
    if (s.display === "grid" || s.display === "inline-grid") return s.gridTemplateColumns.split(" ").filter(Boolean).length > 1;
    return (s.display === "flex" || s.display === "inline-flex") && s.flexDirection.startsWith("row");
  };
  const seen = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const a = fields[i];
      const b = fields[j];
      // lowest common ancestor
      let lca: Element | null = a.parentElement;
      while (lca && !lca.contains(b)) lca = lca.parentElement;
      if (!lca || !multiColumn(lca)) continue;
      const ca = [...lca.children].find((c) => c.contains(a))!;
      const cb = [...lca.children].find((c) => c.contains(b))!;
      if (!ca || !cb || ca === cb) continue;
      // only cells that hold one field (a label + its control), not whole columns of a form
      if (fields.filter((f) => ca.contains(f)).length > 1 || fields.filter((f) => cb.contains(f)).length > 1) continue;
      const ra = ca.getBoundingClientRect();
      const rb = cb.getBoundingClientRect();
      const overlap = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlap < Math.min(ra.height, rb.height) * 0.5) continue; // not the same row
      const fa = a.getBoundingClientRect();
      const fb = b.getBoundingClientRect();
      const textarea = a.tagName === "TEXTAREA" || b.tagName === "TEXTAREA";
      const key = `${name(a)}|${name(b)}`;
      if (seen.has(key)) continue;
      if (Math.abs(fa.top - fb.top) > 2) {
        seen.add(key);
        out.push(`fields in one row don't line up: ${tag(a)} top ${Math.round(fa.top)} vs ${tag(b)} top ${Math.round(fb.top)}`);
      } else if (!textarea && Math.abs(fa.height - fb.height) > 2) {
        seen.add(key);
        out.push(`fields in one row differ in height: ${tag(a)} ${Math.round(fa.height)}px vs ${tag(b)} ${Math.round(fb.height)}px`);
      }
    }
  }

  // 6. large empty holes in grids
  const title = (n: Element) => ((n.querySelector("h1,h2,h3,h4,p") as HTMLElement | null)?.innerText || (n as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const contentBottom = (n: Element) => {
    let bottom = -Infinity;
    for (const c of n.querySelectorAll("*")) {
      if (!shown(c)) continue;
      // leaves, and inner panels with their own background (an empty state that fills its card is not a hole)
      if (c.children.length && !isFrame(c)) continue;
      bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
    }
    return bottom;
  };
  for (const g of [...root.querySelectorAll("*")].filter((n) => getComputedStyle(n).display === "grid" && shown(n))) {
    const cols = getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length;
    if (cols < 2) continue;
    // sticky side panels move while the page scrolls; they aren't part of the grid's rows
    const sticky = (n: Element | null) => !!n && getComputedStyle(n).position === "sticky";
    const items = [...g.children].filter((x) => shown(x) && !sticky(x) && !(x.children.length === 1 && sticky(x.firstElementChild)));
    if (items.length < 2) continue;
    // a list of like cards may end with a short last row; a dashboard of different cards may not
    const like = (a: Element, b: Element) => {
      const x = new Set(String(a.className).split(/\s+/));
      const y = new Set(String(b.className).split(/\s+/));
      const shared = [...x].filter((c) => y.has(c)).length;
      return a.tagName === b.tagName && shared / Math.max(x.size, y.size, 1) >= 0.7;
    };
    const list = items.every((x) => like(x, items[0]));
    const gr = g.getBoundingClientRect();
    if (gr.width < HOLE_W * 2) continue;
    // grid rows: items whose boxes overlap vertically (an item aligned to the end of its cell is still in the row)
    const rows: Element[][] = [];
    for (const it of items) {
      const a = it.getBoundingClientRect();
      const row = rows.find((rw) => {
        const b = rw[0].getBoundingClientRect();
        return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
      });
      if (row) row.push(it);
      else rows.push([it]);
    }
    // only boxes (cards, or columns of cards) leave holes worth reporting; a line of text beside a table doesn't
    const boxy = (n: Element) =>
      [n, ...n.querySelectorAll(":scope > *, :scope > * > *")].some((x) => isFrame(x) && x.getBoundingClientRect().height >= 64 && !x.matches("button, input, select, textarea"));
    for (const row of rows) {
      const bottom = Math.max(...row.map((x) => x.getBoundingClientRect().bottom));
      const rowH = bottom - Math.min(...row.map((x) => x.getBoundingClientRect().top));
      for (const it of row) {
        const r = it.getBoundingClientRect();
        if (r.width < HOLE_W) continue;
        // a side panel (sticky summary, section menu) may be shorter than the page beside it
        const side = (n: Element | null) => !!n && (n.matches("nav, aside") || getComputedStyle(n).position === "sticky");
        const sidePanel = side(it) || (it.children.length === 1 && side(it.firstElementChild));
        if (!boxy(it)) continue;
        if (!sidePanel && bottom - r.bottom >= HOLE_H) out.push(`empty space under «${title(it)}» (${Math.round(bottom - r.bottom)}px)`);
        else if (isFrame(it) || it.firstElementChild && isFrame(it.firstElementChild) && it.children.length === 1) {
          const card = isFrame(it) ? it : it.firstElementChild!;
          const pad = parseFloat(getComputedStyle(card).paddingBottom) || 0;
          const gap = card.getBoundingClientRect().bottom - pad - contentBottom(card);
          if (gap >= HOLE_H) out.push(`card stretched with empty space: «${title(card)}» (${Math.round(gap)}px)`);
        }
      }
      const used = row.reduce((a, x) => a + x.getBoundingClientRect().width, 0);
      const empty = gr.width - used - (row.length - 1) * (parseFloat(getComputedStyle(g).columnGap) || 0);
      if (row.length < cols && empty >= HOLE_W && rowH >= HOLE_H && rows.length > 1 && row.some(boxy) && !(list && row === rows[rows.length - 1])) {
        out.push(`empty space beside «${title(row[0])}» (${Math.round(empty)}×${Math.round(rowH)}px)`);
      }
    }
  }
  // 8. controls drawn over each other (a select under a number field, a button over an input)
  // floating / sticky bars (assistant button, top bar, sticky panels) pass over the page on purpose
  const floating = (e: Element) => {
    for (let n: Element | null = e; n && n !== dialog; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === "fixed" || pos === "sticky") return true;
    }
    return false;
  };
  // the part of a control actually visible: clipped by the boxes it scrolls in (a dialog body under its footer)
  const visibleRect = (e: Element) => {
    const r = e.getBoundingClientRect();
    let { left, right, top, bottom } = r;
    for (let n = e.parentElement; n; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.overflowX === "visible" && st.overflowY === "visible") continue;
      const c = n.getBoundingClientRect();
      left = Math.max(left, c.left);
      right = Math.min(right, c.right);
      top = Math.max(top, c.top);
      bottom = Math.min(bottom, c.bottom);
    }
    return { left, right, top, bottom };
  };
  const boxes = controls.filter((e) => e.matches(`${fieldish}, button, [role=combobox], a[href]`) && !floating(e));
  const overlapSeen = new Set<string>();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = visibleRect(a);
      const rb = visibleRect(b);
      if (ra.right - ra.left < 1 || ra.bottom - ra.top < 1 || rb.right - rb.left < 1 || rb.bottom - rb.top < 1) continue;
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 4 && h > 4) {
        const key = `${name(a)}|${name(b)}`;
        if (overlapSeen.has(key)) continue;
        overlapSeen.add(key);
        out.push(`controls overlap: ${tag(a)} and ${tag(b)} (${Math.round(w)}×${Math.round(h)}px)`);
      }
    }
  }

  // 9. engine keys shown as they are in the Arabic app ("5 pack", "wet") instead of their translation
  if (document.documentElement.lang === "ar") {
    const KEYS = /\b(pack|pcs|sheet|bar|box|roll|bag|board|pail|trip|wet|decorative|moisture)\b/;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const keySeen = new Set<string>();
    while (w.nextNode()) {
      const n = w.currentNode as Text;
      const el = n.parentElement;
      if (!el || el.closest("script, style, option") || !shown(el)) continue;
      const text = (n.textContent ?? "").trim();
      const m = text.match(KEYS);
      // a key among Arabic words or after a number ("المتاح هنا: 120 board"), or a key on its own (a "wet" badge);
      // an English product or service name ("Gypsum board ceilings") is data, not a key
      const keyHere = m && (/[\u0600-\u06FF]/.test(text) || new RegExp(`\\d\\s*${m[1]}\\b`).test(text) || text === m[1]);
      if (m && keyHere && !keySeen.has(m[1])) {
        keySeen.add(m[1]);
        out.push(`untranslated key «${m[1]}» in «${(n.textContent ?? "").trim().slice(0, 40)}»`);
      }
    }
  }

  // 7. cards side by side in one row must share their top and height
  const cardOf = (n: Element): Element | null => {
    let c: Element | null = n;
    for (let depth = 0; c && depth < 3; depth++) {
      const r = c.getBoundingClientRect();
      if (isFrame(c) && !c.matches("button, input, select, textarea, [role=radio], [role=tab]") && r.height >= 64 && r.width >= 120) return c;
      const kids: Element[] = [...c.children].filter(shown);
      c = kids.length === 1 ? kids[0] : null;
    }
    return null;
  };
  for (const g of [...root.querySelectorAll("*")].filter((n) => shown(n) && multiColumn(n))) {
    const items = [...g.children].filter(shown);
    if (items.length < 2) continue;
    const rows: Element[][] = [];
    for (const it of items) {
      const top = it.getBoundingClientRect().top;
      const row = rows.find((rw) => Math.abs(rw[0].getBoundingClientRect().top - top) < 4);
      if (row) row.push(it);
      else rows.push([it]);
    }
    for (const row of rows) {
      if (row.some((x) => x.matches("nav, aside") || getComputedStyle(x).position === "sticky")) continue; // a side panel beside a page
      const cards = row.map(cardOf).filter((c): c is Element => !!c);
      if (cards.length < 2 || cards.length !== row.length) continue;
      const [first, ...rest] = cards;
      const a = first.getBoundingClientRect();
      for (const c of rest) {
        const b = c.getBoundingClientRect();
        if (Math.abs(a.top - b.top) > 2 || Math.abs(a.height - b.height) > 2) {
          out.push(`cards side by side differ: «${title(first)}» ${Math.round(a.top)}/${Math.round(a.height)}px vs «${title(c)}» ${Math.round(b.top)}/${Math.round(b.height)}px`);
          break;
        }
      }
    }
  }
  return [...new Set(out)];
}
