import { describe, expect, it } from 'vitest';
import { buildFolderTree, groupDocsByFolder, useFolderStore } from '../store/documents/folders.ts';

const doc = (id, updated = '2026-01-01') => ({
  id,
  title: id,
  updated,
  created: updated,
  wordCount: 0,
  tags: [],
  hasResiduals: false,
  originFormat: 'markdown',
});

describe('buildFolderTree', () => {
  it('nests documents under their folders and leaves the rest at root', () => {
    const folders = [
      { id: 'f1', name: 'Alpha', parentId: null },
      { id: 'f2', name: 'Beta', parentId: 'f1' },
    ];
    const docs = [doc('a'), doc('b'), doc('c')];
    const docParents = { a: 'f1', b: 'f2' };
    const tree = buildFolderTree(docs, folders, docParents);

    expect(tree.rootDocs.map((d) => d.id)).toEqual(['c']);
    expect(tree.rootFolders).toHaveLength(1);
    const alpha = tree.rootFolders[0];
    expect(alpha.folder.id).toBe('f1');
    expect(alpha.docs.map((d) => d.id)).toEqual(['a']);
    expect(alpha.children[0].folder.id).toBe('f2');
    expect(alpha.children[0].docs.map((d) => d.id)).toEqual(['b']);
  });

  it('falls back to root when a parent folder is missing', () => {
    const tree = buildFolderTree([doc('a')], [], { a: 'ghost' });
    expect(tree.rootDocs.map((d) => d.id)).toEqual(['a']);
  });
});

describe('useFolderStore', () => {
  it('createFolder / moveDoc / deleteFolder reparent correctly', () => {
    const s = useFolderStore.getState();
    s.setInitialTree({ folders: [], docParents: {}, expanded: {} });
    const parent = useFolderStore.getState().createFolder('P', null);
    const child = useFolderStore.getState().createFolder('C', parent);
    useFolderStore.getState().moveDoc('doc1', child);
    expect(useFolderStore.getState().docParents['doc1']).toBe(child);

    // Deleting the child reparents its docs up to the parent.
    useFolderStore.getState().deleteFolder(child);
    expect(useFolderStore.getState().folders.find((f) => f.id === child)).toBeUndefined();
    expect(useFolderStore.getState().docParents['doc1']).toBe(parent);
  });

  it('prevents moving a folder into its own descendant', () => {
    const s = useFolderStore.getState();
    s.setInitialTree({ folders: [], docParents: {}, expanded: {} });
    const a = useFolderStore.getState().createFolder('A', null);
    const b = useFolderStore.getState().createFolder('B', a);
    useFolderStore.getState().moveFolder(a, b); // would create a cycle → ignored
    expect(useFolderStore.getState().folders.find((f) => f.id === a).parentId).toBe(null);
  });

  it('pruneOrphans drops metadata for missing docs', () => {
    const s = useFolderStore.getState();
    s.setInitialTree({
      folders: [{ id: 'f', name: 'F', parentId: null }],
      docParents: { keep: 'f', gone: 'f' },
      expanded: {},
    });
    useFolderStore.getState().pruneOrphans(new Set(['keep']));
    expect(useFolderStore.getState().docParents).toEqual({ keep: 'f' });
  });
});

describe('groupDocsByFolder', () => {
  const folders = [
    { id: 'f1', name: 'Projects', parentId: null },
    { id: 'f2', name: 'Archive', parentId: null },
  ];
  const docParents = { a: 'f1', b: 'f1', c: 'f2' };

  it('groups docs by their folder, skipping root docs', () => {
    const groups = groupDocsByFolder(['a', 'b', 'c', 'd'], folders, docParents);
    expect(groups).toHaveLength(2);
    const projects = groups.find((g) => g.id === 'f1');
    expect(projects.name).toBe('Projects');
    expect(projects.docIds.sort()).toEqual(['a', 'b']);
    expect(groups.find((g) => g.id === 'f2').docIds).toEqual(['c']);
    // 'd' has no parent → belongs to no group
    expect(groups.flatMap((g) => g.docIds)).not.toContain('d');
  });

  it('omits folders whose docs are not in the given set', () => {
    const groups = groupDocsByFolder(['a'], folders, docParents);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('f1');
  });

  it('ignores a docParent pointing at a deleted folder', () => {
    const groups = groupDocsByFolder(['a'], folders, { a: 'gone' });
    expect(groups).toEqual([]);
  });

  it('returns empty for no docs', () => {
    expect(groupDocsByFolder([], folders, docParents)).toEqual([]);
  });
});

describe('store → graph folder grouping (integration)', () => {
  it('a doc moved into a folder appears in that folder group', () => {
    const store = useFolderStore.getState();
    store.setInitialTree({ folders: [], docParents: {}, docOrder: {} });
    const fid = useFolderStore.getState().createFolder('Projects', null);
    useFolderStore.getState().moveDoc('docA', fid);
    useFolderStore.getState().moveDoc('docB', fid);
    const { folders, docParents } = useFolderStore.getState();
    const groups = groupDocsByFolder(['docA', 'docB', 'docC'], folders, docParents);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Projects');
    expect(groups[0].docIds.sort()).toEqual(['docA', 'docB']);
  });
});
