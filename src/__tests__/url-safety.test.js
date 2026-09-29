import { describe, it, expect } from "vitest";
import { isExternalHref, isDangerousUrl } from "../utils/url-safety";

describe("isExternalHref", () => {
  it("treats http/https/mailto/tel and protocol-relative as external", () => {
    for (const h of ["http://x.com", "https://x.com/a", "mailto:a@b.com", "tel:+1555", "//cdn.example.com/x"]) {
      expect(isExternalHref(h)).toBe(true);
    }
  });

  it("treats custom schemes and relative paths as NOT external (deep links)", () => {
    for (const h of ["app://node/123", "perssonify://open/x", "/docs/intro", "#section", "relative/path", ""]) {
      expect(isExternalHref(h)).toBe(false);
    }
  });
});

describe("isDangerousUrl (regression)", () => {
  it("still blocks script-bearing schemes and non-raster data URIs", () => {
    expect(isDangerousUrl("javascript:alert(1)")).toBe(true);
    expect(isDangerousUrl("data:text/html,<script>")).toBe(true);
    expect(isDangerousUrl("data:image/svg+xml,<svg onload=1>")).toBe(true);
    expect(isDangerousUrl("https://example.com")).toBe(false);
    expect(isDangerousUrl("data:image/png;base64,iVBOR")).toBe(false);
  });
});
