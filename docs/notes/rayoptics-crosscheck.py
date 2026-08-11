"""Generate the rayoptics cross-check fixture.

Traces a fixed list of explicitly-specified rays through a fixed list of
explicitly-specified systems, using rayoptics' own raw ray trace, and writes
both the inputs and rayoptics' answers to one JSON file. The TypeScript side
rebuilds the same systems from the same file and compares.

This script is NOT run by `npm test`, and must not be: the fixture it writes is
the external number, so it is committed and the suite reads it directly. The
script is here so the number can be re-derived and argued with, which is the
whole point of a cross-validation.

Regenerating (Python >= 3.12, which is what rayoptics 0.9.9 requires):

    python -m venv .venv
    .venv/bin/pip install rayoptics==0.9.9
    .venv/bin/python docs/notes/rayoptics-crosscheck.py \\
        packages/core/test/fixtures/rayoptics-crosscheck.json

then run `npm test` — the version assertion in crosscheck.test.ts will fail
first if a different rayoptics wrote the file, which is deliberate: a reference
that silently changes underneath is not a reference.

Deliberate choices, each removing a convention that could turn a disagreement
into an argument about definitions rather than about arithmetic:

  * raw rays (`trace_raw`, `intersect_obj=False`) — the starting point and
    direction are given, so no pupil coordinate, ray aiming, field definition
    or object-at-infinity convention enters on either side.
  * `check_apertures=False` and every ray kept well inside every rim, so
    neither tracer clips.
  * `ConstantIndex` media carrying the index Telemicroscope's own catalog
    reports at the trace wavelength, so glass data is out of the comparison —
    this fixture pins geometry, Snell and path length, and nothing else.
  * gap 0 set to zero thickness, so rayoptics' object interface sits on
    surface 0's vertex and both sides use one coordinate origin.
  * the trace stops at the last surface — no image plane, no focus.

Even-asphere convention: rayoptics' EvenPolynomial `coefs` start at r^2,
Telemicroscope's `asphereCoeffs` start at r^4, so a zero is prepended here.
"""
import json
import math
import sys

import numpy as np
import rayoptics
from rayoptics.optical.opticalmodel import OpticalModel
from rayoptics.elem.profiles import Conic, EvenPolynomial
from rayoptics.raytr import raytrace
from opticalglass.opticalmedium import ConstantIndex

WVL = 587.5618

# Indices Telemicroscope's catalog reports at WVL (packages/core/src/materials).
N_AIR = 1.0
N_BK7 = 1.5168000345005883
N_F2 = 1.6200401372462678

# --- the systems -------------------------------------------------------------
# curvature 1/mm, thickness mm, indexAfter = index of the medium following the
# surface. Captured once from the designs named in each note; literal here
# thereafter, so the fixture is a system rather than a reference to a solver.

SYSTEMS = [
    {
        "id": "achromat-60mm-f8",
        "note": "designs/achromat achromaticObjective({apertureMm: 60, focalRatio: 8}), "
                "shallow branch, d line. Cemented crown-first doublet.",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": 0.004437387699444715, "thickness": 6.0, "indexAfter": N_BK7},
            {"curvature": -0.004867095229174069, "thickness": 3.5999999999999996, "indexAfter": N_F2},
            {"curvature": -0.00047185756393146663, "thickness": 0.0, "indexAfter": N_AIR},
        ],
        # Collimated rays at a range of pupil heights (glass semi-aperture is
        # 30.15 mm, so 29 is inside), plus two oblique and two skew rays.
        "rays": (
            [{"origin": [0.0, h, -50.0], "dir": [0.0, 0.0, 1.0]} for h in (0.0, 6.0, 12.0, 18.0, 24.0, 29.0)]
            + [
                {"origin": [0.0, h, -50.0],
                 "dir": [0.0, math.sin(math.radians(0.4)), math.cos(math.radians(0.4))]}
                for h in (-20.0, 0.0, 20.0)
            ]
            + [
                {"origin": [12.0, -17.0, -50.0], "dir": [0.0, 0.0, 1.0]},
                {"origin": [-8.0, 5.0, -50.0],
                 "dir": [math.sin(math.radians(0.3)), math.sin(math.radians(-0.2)),
                         math.sqrt(1 - math.sin(math.radians(0.3))**2 - math.sin(math.radians(0.2))**2)]},
            ]
        ),
    },
    {
        "id": "lister-20x-na0.25",
        "note": "designs/lister listerObjective({magnification: 20, numericalAperture: 0.25}), "
                "d line, specimen-side first. Six surfaces, two cemented doublets.",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": -0.047669805610512955, "thickness": 0.2328025344618288, "indexAfter": N_F2},
            {"curvature": 0.10710773194109915, "thickness": 0.7173834011946942, "indexAfter": N_BK7},
            {"curvature": -0.22054803222180133, "thickness": 6.0, "indexAfter": N_AIR},
            {"curvature": 0.0056653019219457396, "thickness": 0.35631446785107224, "indexAfter": N_F2},
            {"curvature": 0.10885032695635381, "thickness": 1.1084608496059638, "indexAfter": N_BK7},
            {"curvature": -0.10958684915224655, "thickness": 0.0, "indexAfter": N_AIR},
        ],
        # A diverging cone from a point 3 mm in front of the first vertex.
        # sin u up to 0.22 keeps every ray inside the 1.95 mm rims.
        "rays": (
            [{"origin": [0.0, 0.0, -3.0],
              "dir": [0.0, math.sin(math.asin(s)), math.cos(math.asin(s))]}
             for s in (0.0, 0.05, 0.10, 0.15, 0.20, -0.20)]
            + [{"origin": [0.0, 0.02, -3.0],
                "dir": [0.0, math.sin(math.asin(s)), math.cos(math.asin(s))]}
               for s in (0.0, 0.18)]
            + [{"origin": [0.0, 0.0, -3.0],
                "dir": [0.12, 0.09, math.sqrt(1 - 0.12**2 - 0.09**2)]}]
        ),
    },
    {
        "id": "cassegrain-200mm-f10",
        "note": "designs/cassegrain cassegrain({apertureMm: 200, focalRatio: 10, "
                "primaryFocalRatio: 4}). Paraboloid + hyperboloid, unfolded frame: "
                "the thickness after the primary is negative and rays run -z.",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": -0.000625, "conic": -1.0, "thickness": -560.0, "reflect": True},
            {"curvature": -0.00125, "conic": -5.4444444444444455, "thickness": 0.0, "reflect": True},
        ],
        # Collimated, inside the 100 mm primary rim and outside the 30.1 mm
        # secondary shadow so every ray is one the real telescope carries.
        "rays": (
            [{"origin": [0.0, h, -100.0], "dir": [0.0, 0.0, 1.0]} for h in (40.0, 60.0, 80.0, 95.0, -70.0)]
            + [{"origin": [0.0, h, -100.0],
                "dir": [0.0, math.sin(math.radians(0.05)), math.cos(math.radians(0.05))]}
               for h in (50.0, 90.0)]
            + [{"origin": [45.0, 62.0, -100.0], "dir": [0.0, 0.0, 1.0]}]
        ),
    },
    {
        "id": "asphere-singlet",
        "note": "Synthetic, not a design: a conic front and an even-asphere rear on one "
                "N-BK7 singlet, so the fixture reaches surface shapes the presets only "
                "put on mirrors. asphereCoeffs are A4, A6 (mm^-3, mm^-5).",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": 0.01, "conic": -0.6, "thickness": 8.0, "indexAfter": N_BK7},
            {"curvature": -0.005, "conic": 0.4, "asphereCoeffs": [1.0e-7, -2.0e-11],
             "thickness": 0.0, "indexAfter": N_AIR},
        ],
        "rays": (
            [{"origin": [0.0, h, -25.0], "dir": [0.0, 0.0, 1.0]} for h in (0.0, 5.0, 10.0, 15.0, 20.0)]
            + [{"origin": [0.0, h, -25.0],
                "dir": [0.0, math.sin(math.radians(1.0)), math.cos(math.radians(1.0))]}
               for h in (-12.0, 12.0)]
            + [{"origin": [9.0, -13.0, -25.0], "dir": [0.0, 0.0, 1.0]}]
        ),
    },
]


def build(system):
    opm = OpticalModel(radius_mode=False)
    sm = opm['seq_model']

    # Object interface on surface 0's vertex, so one coordinate origin serves
    # both tracers.
    sm.gaps[0].thi = 0.0
    sm.gaps[0].medium = ConstantIndex(system['objectIndex'], 'obj')

    for s in system['surfaces']:
        sm.add_surface([0.0, s['thickness']])
        ifc = sm.ifcs[-2]           # the surface just added (last is the image)
        coefs = s.get('asphereCoeffs')
        if coefs:
            # rayoptics coefs start at r^2; Telemicroscope's start at r^4.
            ifc.profile = EvenPolynomial(c=s['curvature'], cc=s.get('conic', 0.0),
                                         coefs=[0.0] + list(coefs))
        else:
            ifc.profile = Conic(c=s['curvature'], cc=s.get('conic', 0.0))
        if s.get('reflect'):
            ifc.interact_mode = 'reflect'
        else:
            sm.gaps[-1].medium = ConstantIndex(s['indexAfter'], 'm')

    sm.set_stop(0)
    sm.update_model()
    return opm


def trace_one(opm, system, ray_spec):
    sm = opm['seq_model']
    pt0 = np.array(ray_spec['origin'], dtype=float)
    d = np.array(ray_spec['dir'], dtype=float)
    dir0 = d / np.linalg.norm(d)

    # last_surf keeps the trace off the image plane: the comparison ends on the
    # last real surface, so no image-plane convention enters.
    n_surf = len(system['surfaces'])
    ray, _op_delta, _wvl = raytrace.trace_raw(
        iter(sm.path(wl=WVL)), pt0, dir0, WVL,
        check_apertures=False, intersect_obj=False, last_surf=n_surf)

    # ray[i] = [pt, after_dir, after_dst, normal]; ray[0] is the launch point
    # and ray[n_surf] is the last real surface. `last_surf` does not suppress
    # the image interface, so the tail is dropped here: the comparison ends on
    # the last surface, exactly where Telemicroscope's traceRay ends.
    ray = ray[:n_surf + 1]

    indices = [system['objectIndex']]
    for s in system['surfaces']:
        # a mirror keeps the incident medium
        indices.append(indices[-1] if s.get('reflect') else s['indexAfter'])

    opl = 0.0
    for i in range(n_surf):
        opl += indices[i] * ray[i][2]

    # Points come back in each interface's own frame. Every system here is
    # axial, so that frame differs from the launch frame by the vertex offset
    # alone — accumulated thickness, signed, which is Telemicroscope's
    # convention too.
    vertex_z = [0.0]
    for s in system['surfaces']:
        vertex_z.append(vertex_z[-1] + s['thickness'])

    def to_global(pt, i):
        return [float(pt[0]), float(pt[1]), float(pt[2]) + vertex_z[i]]

    # ray[0] is on the object interface (vertex 0), ray[i] on surface i-1.
    hits = [to_global(ray[i][0], i - 1 if i > 0 else 0) for i in range(len(ray))]

    return {
        "point": hits[-1],
        "dir": [float(v) for v in ray[-1][1]],
        "opl": float(opl),
        "hits": hits,
    }


def main():
    out = {
        "_generator": {
            "tool": "rayoptics",
            "version": rayoptics.__version__,
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "call": "rayoptics.raytr.raytrace.trace_raw(path, pt0, dir0, wvl, "
                    "check_apertures=False, intersect_obj=False, last_surf=<n>)",
            "script": "docs/notes/rayoptics-crosscheck.py",
        },
        "wavelengthNm": WVL,
        "systems": [],
    }
    for system in SYSTEMS:
        opm = build(system)
        expected = [trace_one(opm, system, r) for r in system['rays']]
        entry = dict(system)
        entry['expected'] = expected
        out['systems'].append(entry)

    path = sys.argv[1] if len(sys.argv) > 1 else "fixture.json"
    with open(path, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", path)
    for s in out['systems']:
        print(s['id'], len(s['rays']), "rays; last hit",
              [round(v, 9) for v in s['expected'][-1]['point']])


if __name__ == "__main__":
    main()
