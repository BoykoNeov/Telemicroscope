import { describe, it, expect } from "vitest";
import { decodeLink, encodeLink, linkHref, LINK_VERSION, type TeachingLink } from "../src/teaching";
import { panelFor, resolveHash, PANELS } from "../src/panels/registry";

/**
 * The teaching link and the route it travels on — APP.md Part H's plumbing.
 *
 * **No engine capability is involved at all**, so no validation-ladder rung is;
 * this file pins a wire format and a router. It exists because the failure it
 * guards against is silent in every other check: a link that does not decode, or
 * a route that eats its own query, produces a page that renders perfectly and
 * explains the wrong lens. There is no exception to throw and no pixel to
 * compare — only this.
 */

const LINK: TeachingLink = {
  lens: "achromat",
  focalLengthMm: 100,
  apertureMm: 12,
  sourceTemperatureK: 5800,
  wavelengths: 9,
  fieldDeg: 1.131371,
  from: "telescope",
};

describe("the teaching link", () => {
  it("round-trips every field, so the plot is about the image that sent it", () => {
    const back = decodeLink(encodeLink(LINK));
    expect(back).toEqual(LINK);
  });

  it("round-trips the on-axis case, where the field is zero and not absent", () => {
    const back = decodeLink(encodeLink({ ...LINK, fieldDeg: 0, lens: "singlet" }));
    expect(back?.fieldDeg).toBe(0);
    expect(back?.lens).toBe("singlet");
  });

  /**
   * The panel's branch on a bad link is "show my own defaults and say so", which
   * is only honest if `null` really is the answer for every kind of damage. A
   * codec that repaired one of these would put a reader in front of a curve for
   * a lens nobody asked about, labelled as the one they clicked.
   */
  it("refuses a damaged link rather than repairing it", () => {
    const good = encodeLink(LINK);
    const damaged: Record<string, string> = {
      empty: "",
      "no version": good.replace(`v=${LINK_VERSION}`, ""),
      "a version this code does not know": good.replace(`v=${LINK_VERSION}`, "v=99"),
      "a missing field": good.replace(/&a=[^&]*/, ""),
      "a field that is not a number": good.replace(/&a=[^&]*/, "&a=wide"),
      "an aperture no slider can reach": good.replace(/&a=[^&]*/, "&a=4000"),
      "a negative aperture": good.replace(/&a=[^&]*/, "&a=-12"),
      "an infinite focal length": good.replace(/&f=[^&]*/, "&f=Infinity"),
      "a NaN field angle": good.replace(/&fld=[^&]*/, "&fld=NaN"),
      "a negative field angle": good.replace(/&fld=[^&]*/, "&fld=-0.5"),
      "a fractional wavelength count": good.replace(/&w=[^&]*/, "&w=8.5"),
      "a lens that does not exist": good.replace(/lens=[^&]*/, "lens=triplet"),
      "a sender that is not a route": good.replace(/&from=[^&]*/, "&from=../etc"),
      "the whole thing shuffled into nonsense": "lens=achromat&f=100",
    };
    for (const [what, query] of Object.entries(damaged)) {
      expect(decodeLink(query), what).toBeNull();
    }
  });

  it("writes a hash the router can read back", () => {
    const href = linkHref("rayfan", LINK);
    expect(href.startsWith("#rayfan?")).toBe(true);
    expect(resolveHash(href).panel.id).toBe("rayfan");
    expect(resolveHash(href).link).toEqual(LINK);
  });
});

describe("the router", () => {
  /**
   * The regression this whole file was written around.
   *
   * `panelFor` matched the entire post-`#/` string against a panel id, so a hash
   * carrying a query matched nothing and fell through to the DEFAULT panel — the
   * star field. A teaching link would have returned the reader to the picture
   * they had just clicked, with nothing thrown, nothing logged and every type
   * checking.
   */
  it("finds the route when the hash carries a query", () => {
    expect(panelFor("#rayfan?v=1&lens=achromat").id).toBe("rayfan");
    expect(panelFor("#/rayfan?v=1&lens=achromat").id).toBe("rayfan");
    expect(panelFor("#chromatic?v=1&a=10").id).toBe("chromatic");
  });

  it("still resolves the plain routes it always did", () => {
    for (const panel of PANELS) {
      expect(panelFor(`#${panel.id}`).id).toBe(panel.id);
      expect(panelFor(`#/${panel.id}`).id).toBe(panel.id);
    }
    expect(panelFor("").id).toBe(PANELS[0]!.id);
    expect(panelFor("#nosuchpanel").id).toBe(PANELS[0]!.id);
  });

  /**
   * "Broken" has to mean *present and unreadable*. A panel that announced a
   * failed link on its own nav entry would be crying wolf, and one that stayed
   * silent about a real failure would be showing defaults under a heading that
   * says otherwise.
   */
  it("tells a missing link apart from a broken one", () => {
    const none = resolveHash("#rayfan");
    expect(none.link).toBeNull();
    expect(none.linkBroken).toBe(false);

    const broken = resolveHash("#rayfan?v=99&lens=achromat");
    expect(broken.link).toBeNull();
    expect(broken.linkBroken).toBe(true);
    expect(broken.panel.id).toBe("rayfan");
  });

  /**
   * The shell keys the mounted panel on id AND query. A second link to the same
   * route with different parameters must therefore look different here, or React
   * would reconcile the old panel — which holds the first link's values in its
   * own state — and the reader would be told they are looking at the new star.
   */
  it("gives two different links to one route two different keys", () => {
    const a = resolveHash(linkHref("rayfan", { ...LINK, fieldDeg: 0.4 }));
    const b = resolveHash(linkHref("rayfan", { ...LINK, fieldDeg: 0.8 }));
    expect(a.panel.id).toBe(b.panel.id);
    expect(a.query).not.toBe(b.query);
  });

  it("gives every panel a unique id, since the id IS the route", () => {
    const ids = PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
