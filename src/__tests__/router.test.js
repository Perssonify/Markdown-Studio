import { describe, expect, it } from "vitest";
import { pathToRoute, routeToPath } from "../app/router";

describe("app router path mapping", () => {
  it("maps known paths to routes", () => {
    expect(pathToRoute("/")).toBe("editor");
    expect(pathToRoute("/about")).toBe("about");
    expect(pathToRoute("/help")).toBe("help");
    expect(pathToRoute("/graph")).toBe("graph");
  });

  it("is case-insensitive and tolerates trailing slashes", () => {
    expect(pathToRoute("/About/")).toBe("about");
    expect(pathToRoute("/HELP")).toBe("help");
    expect(pathToRoute("/graph///")).toBe("graph");
  });

  it("falls back to the editor for unknown paths", () => {
    expect(pathToRoute("/nope")).toBe("editor");
    expect(pathToRoute("")).toBe("editor");
  });

  it("routeToPath round-trips", () => {
    for (const r of ["editor", "about", "help", "graph"]) {
      expect(pathToRoute(routeToPath(r))).toBe(r);
    }
    expect(routeToPath("editor")).toBe("/");
  });
});
