// A library shaped like a real one, for the relationship map at scale (A088).
//
// `docs.mjs`'s `library(n)` is a ring plus one hub with no folders: every note
// has degree 2 or 3, there is one container-free cluster, and every title is
// "Note N". That is fine for "does the map draw 120 notes" and useless for
// "what does 2,000 notes cost", because the expensive parts of the map are
// exactly the ones it leaves out — folder containers (and the hard constraint
// that keeps them apart), hubs with long labels, broken links, unlinked notes.
//
// Everything here is DETERMINISTIC (a seeded PRNG), so two builds are measured
// against the identical library.
const P = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const H = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

/** mulberry32 — small, fast, and the same sequence on every machine. */
export function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPICS = ["Project", "Meeting", "Research", "Design", "Roadmap", "Customer", "Hiring", "Budget",
  "Release", "Incident", "Architecture", "Onboarding", "Retro", "Strategy", "Interview", "Reading"];
const QUALIFIERS = ["", "", "", "Q3 ", "2026 ", "weekly ", "API ", "mobile ", "pricing ", "search ",
  "billing ", "infra "];
const NOUNS = ["notes", "plan", "review", "summary", "ideas", "draft", "checklist", "outline", "log",
  "brief", "proposal", "spec", "findings", "decisions"];
const FOLDER_NAMES = ["Projects", "Meetings", "Research", "Journal", "Clients", "Engineering", "Design",
  "Hiring", "Archive", "Reading list", "Personal", "Operations", "Product", "Marketing", "Finance",
  "Support"];

/**
 * `n` notes. About three quarters are filed into folders whose sizes are
 * skewed (a few big ones, a long tail of small ones); links are 60% within a
 * note's own folder and otherwise preferential towards low-numbered "hub"
 * notes; ~6% of notes link to nothing and ~3% carry a broken link.
 *
 * `folders: false` files nothing: every note at the root, links still
 * hub-and-cluster — the shape of a large FOLDERLESS map, which is laid out
 * differently (a folder map above 500 notes is laid out on two levels, each
 * folder in its own region; see graph-physics.ts).
 *
 * Returns `{ docs, folderTree }`, both for `seedFresh()`.
 */
export function mapLibrary(n, { seed = 7, folders: withFolders = true } = {}) {
  const rand = prng(seed + n);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const titles = Array.from({ length: n }, (_, i) =>
    `${pick(TOPICS)} ${pick(QUALIFIERS)}${pick(NOUNS)} ${i + 1}`);

  const folderCount = Math.max(1, Math.min(60, Math.round(n / 10)));
  const folders = Array.from({ length: folderCount }, (_, i) => ({
    id: `e2e-folder-${i + 1}`,
    name: i < FOLDER_NAMES.length ? FOLDER_NAMES[i] : `${FOLDER_NAMES[i % FOLDER_NAMES.length]} ${Math.floor(i / FOLDER_NAMES.length) + 1}`,
    parentId: null,
  }));
  const docParents = {};
  const members = folders.map(() => []);
  for (let i = 0; i < n; i++) {
    if (rand() < 0.25 || !withFolders) continue; // stays at the root
    const f = Math.min(folderCount - 1, Math.floor(folderCount * Math.pow(rand(), 1.6)));
    docParents[`e2e-map-${i + 1}`] = folders[f].id;
    members[f].push(i);
  }
  const folderOf = new Map();
  members.forEach((list, f) => list.forEach((i) => folderOf.set(i, f)));

  const docs = titles.map((title, i) => {
    const targets = new Set();
    const linkCount = rand() < 0.06 ? 0 : Math.min(8, 1 + Math.floor(-Math.log(1 - rand()) * 1.4));
    for (let tries = 0; targets.size < linkCount && tries < linkCount * 4; tries++) {
      const f = folderOf.get(i);
      const t = f != null && rand() < 0.6 && members[f].length > 1
        ? members[f][Math.floor(rand() * members[f].length)]
        : Math.floor(n * Math.pow(rand(), 2.2));
      if (t !== i) targets.add(t);
    }
    const links = [...targets].map((t) => `[[${titles[t]}]]`);
    if (rand() < 0.03) links.push(`[[Missing note ${i + 1}]]`);
    const content = [H(1, title)];
    if (links.length) content.push(P(`Related: ${links.join(", ")}.`));
    content.push(H(2, "Summary"), P(`Working notes for ${title.toLowerCase()}.`),
      H(2, "Next steps"), P("Follow up next week."));
    return { id: `e2e-map-${i + 1}`, title, canonical: { type: "doc", content } };
  });

  return { docs, folderTree: { folders: withFolders ? folders : [], docParents, docOrder: {}, expanded: {} } };
}

/**
 * Seed a library into a store the app has NEVER booted on, then leave it to
 * `boot()`. The app's first load on an empty store imports its starter
 * documents with fresh ids — so seeding after that (as `seed()` callers do)
 * gives every run a slightly different library, in a different ring order, and
 * two builds could never be compared drawing for drawing. This loads a static
 * file on the app's origin instead (no app, same IndexedDB), creates the
 * database exactly as the adapter's upgrade does, and writes the documents,
 * the manifest and the folder tree in one transaction.
 */
export async function seedFresh(page, port, docs, folderTree) {
  await page.goto(`http://127.0.0.1:${port}/site.webmanifest`, { waitUntil: "load" });
  await page.evaluate(async ({ docs, folderTree }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("perssonify-docs", 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains("documents")) r.result.createObjectStore("documents");
        if (!r.result.objectStoreNames.contains("meta")) r.result.createObjectStore("meta");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const now = new Date().toISOString();
    await new Promise((res, rej) => {
      const tx = db.transaction(["documents", "meta"], "readwrite");
      for (const d of docs) {
        tx.objectStore("documents").put(JSON.stringify({
          id: d.id, userTitle: d.title, titlePinnedByUser: true, title: d.title,
          origin: { format: "markdown", raw: "" }, canonical: d.canonical,
          residuals: [], ingestReport: null, metadata: {}, tags: [],
          created: now, updated: now,
        }), d.id);
      }
      tx.objectStore("meta").put(JSON.stringify({ documents: docs.map((d) => ({
        id: d.id, title: d.title, updated: now, created: now,
        wordCount: 100, tags: [], hasResiduals: false, originFormat: "markdown",
      })) }), "__manifest");
      tx.objectStore("meta").put(JSON.stringify({ folderTree }), "__prefs");
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, { docs, folderTree });
}
