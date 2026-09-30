// What the relationship map has actually drawn, measured in the page — for
// the stress tier's large-map case and probes/map-overlap.mjs. Pass it to
// `page.evaluate`.
//
// CLAUDE.md's "nothing is drawn over text" claims are checked on the rendered
// DOM: label↔label, label↔dot, label↔chip, label↔canvas edge, a stranger's
// label or dot inside a container, container↔container and chip↔chip — plus
// chip↔dot, which is NOT zero by design (chips paint last).
//
// A small map's dots are `.pf-node-dot` elements; a large map's ordinary dots
// are batched `.pf-node-dots` paths carrying their ids in draw order, read
// back through the path data and the path's own screen CTM. Same geometry,
// either way.
export const measureMap = () => {
  const svg = document.querySelector('svg[aria-label^="Relationship map"]');
  if (!svg) return null;
  const S = svg.getBoundingClientRect();
  const box = (r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  const hit = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;

  const dots = [];
  for (const c of svg.querySelectorAll(".pf-node-dot")) {
    dots.push({ id: c.closest("[data-doc-id]")?.getAttribute("data-doc-id"), b: box(c.getBoundingClientRect()) });
  }
  const full = new Set(dots.map((d) => d.id));
  let batched = 0;
  const batchedIds = [];
  for (const p of svg.querySelectorAll(".pf-node-dots")) {
    const ids = (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
    const m = p.getScreenCTM();
    const re = /M(-?\d+),(-?\d+)a(\d+),\d+ 0 1 1 (-?\d+),0/g;
    const d = p.getAttribute("d") || "";
    let i = 0;
    for (let g = re.exec(d); g; g = re.exec(d), i++) {
      const id = ids[i];
      batchedIds.push(id);
      batched++;
      if (full.has(id)) continue; // drawn in full on top: measured from its element
      const x0 = Number(g[1]), y = Number(g[2]), r = Number(g[3]), cx = x0 + Number(g[4]) / 2;
      const sx = m.a * cx + m.c * y + m.e, sy = m.b * cx + m.d * y + m.f, sr = r * m.a;
      dots.push({ id, b: { x0: sx - sr, y0: sy - sr, x1: sx + sr, y1: sy + sr } });
    }
    if (i !== ids.length) return { error: `a batched path has ${i} circles for ${ids.length} ids` };
  }
  const labels = [...svg.querySelectorAll(".pf-node-label")].map((t) => ({
    id: t.closest("[data-doc-id]")?.getAttribute("data-doc-id") ?? t.closest("[data-label-for]")?.getAttribute("data-label-for"),
    b: box(t.getBoundingClientRect()), text: t.textContent,
  }));
  const boxes = [...svg.querySelectorAll(".pf-folder-box")].map((r) => ({
    docs: new Set((r.closest("[data-folder-docs]")?.getAttribute("data-folder-docs") || "").split(" ")),
    b: box(r.getBoundingClientRect()),
  }));
  const chips = [...svg.querySelectorAll(".pf-folder-chip")].map((r) => box(r.getBoundingClientRect()));

  // strangerLabel: a name inside a folder box its note is not in, while its DOT
  // is outside that box — the false membership the label veto forbids.
  // strangerLabelOwnDot: the same where the veto allows it — the dot already
  // sits in that box, or the name lies wholly inside the note's OWN box (both
  // only happen where folders overlap; see crossesForeignContainer).
  const count = { labelLabel: 0, labelDot: 0, labelChip: 0, labelEdge: 0, strangerLabel: 0, strangerLabelOwnDot: 0, boxBox: 0, strangerDot: 0, chipChip: 0, chipDot: 0 };
  const dotCentre = new Map(dots.map((d) => [d.id, { x: (d.b.x0 + d.b.x1) / 2, y: (d.b.y0 + d.b.y1) / 2 }]));
  const within = (p, b) => !!p && p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) if (hit(labels[i].b, labels[j].b)) count.labelLabel++;
    for (const d of dots) if (hit(labels[i].b, d.b)) count.labelDot++;
    for (const c of chips) if (hit(labels[i].b, c)) count.labelChip++;
    const l = labels[i].b;
    if (l.x0 < S.left - 0.5 || l.y0 < S.top - 0.5 || l.x1 > S.right + 0.5 || l.y1 > S.bottom + 0.5) count.labelEdge++;
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i].b, boxes[j].b)) count.boxBox++;
    for (const d of dots) if (!boxes[i].docs.has(d.id) && hit(boxes[i].b, d.b)) count.strangerDot++;
    for (const l of labels) {
      if (boxes[i].docs.has(l.id) || !hit(boxes[i].b, l.b)) continue;
      const ownHolds = boxes.some((o) => o.docs.has(l.id) && l.b.x0 >= o.b.x0 && l.b.x1 <= o.b.x1 && l.b.y0 >= o.b.y0 && l.b.y1 <= o.b.y1);
      if (ownHolds || within(dotCentre.get(l.id), boxes[i].b)) count.strangerLabelOwnDot++;
      else count.strangerLabel++;
    }
  }
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) if (hit(chips[i], chips[j])) count.chipChip++;
    for (const d of dots) if (hit(chips[i], d.b)) count.chipDot++;
  }

  // Everything drawn, in a canonical form, so two builds can be compared.
  const r2 = (v) => Math.round(v * 100) / 100;
  const print = JSON.stringify({
    cam: svg.querySelector(":scope > g")?.style.transform,
    dots: dots.map((d) => [d.id, r2(d.b.x0), r2(d.b.y0), r2(d.b.x1 - d.b.x0)]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    labels: labels.map((l) => [l.id, l.text, r2(l.b.x0), r2(l.b.y0)]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    boxes: boxes.map((x) => [r2(x.b.x0), r2(x.b.y0), r2(x.b.x1), r2(x.b.y1)]),
    chips: chips.map((c) => [r2(c.x0), r2(c.y0), r2(c.x1)]),
  });
  const header = svg.getAttribute("aria-label") || "";
  const documents = Number((header.match(/(\d+) documents/) || [])[1] || 0);
  const drawn = new Set(dots.map((d) => d.id));
  return {
    count, print, documents,
    dots: dots.length, drawn: drawn.size, batched, batchedUnique: new Set(batchedIds).size,
    labels: labels.length, boxes: boxes.length,
  };
};
