import '@testing-library/jest-dom';

// jsdom lays nothing out, and it does not implement the geometry of a text
// RANGE at all — `Element#getClientRects` / `getBoundingClientRect` exist and
// return zeros, the Range versions are simply missing. ProseMirror and
// CodeMirror both measure text through a Range, so the first measurement threw
// "getClientRects is not a function". The worst of it was deferred: Tiptap's
// `focus()` scrolls the selection into view on the NEXT animation frame, so a
// test that formatted through `chain().focus()` could pass and then crash after
// it had finished, exiting the run 1 with every test green — depending only on
// whether that frame fired before the environment was torn down. Give Range the
// same empty geometry an Element already has (the same shapes jsdom returns),
// and only where the environment lacks it, so a jsdom that grows a real
// implementation keeps it. Pinned by testenv-geometry.test.jsx.
if (typeof Range !== 'undefined') {
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = function getClientRects() {
      return [];
    };
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { x: 0, y: 0, bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 };
    };
  }
}
