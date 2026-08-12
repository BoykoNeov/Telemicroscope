"""Generate the Optiland cross-check fixture — the SECOND independent tracer.

docs/VALIDATION.md § 0.4. The first cross-validation (§ 0–§ 0.3,
`rayoptics-crosscheck.py`) turned "the engine agrees with a closed form" into
"the engine agrees with another program". This one turns an agreement into a
majority: a third implementation, sharing no lineage with either, traces the
SAME sixteen systems along the SAME rays, and its answers are compared both
against the engine and — with the engine out of it entirely — against
rayoptics'.

The inputs are not re-derived. This script reads `surfaces`, `rays`,
`objectIndex`, `mirrorFrames` and the wavelength VERBATIM out of the committed
rayoptics fixture, so the three programs are provably answering one question and
not three similar ones. The TypeScript side asserts that identity field by field
before it compares an answer.

This script is NOT run by `npm test`, and must not be: the fixture it writes is
the external number, so it is committed and the suite reads it directly.

Regenerating (Windows paths, since that is this project's platform; use bin/
instead of Scripts/ elsewhere). The venv is built OUTSIDE the repo on purpose:

    uv venv --python 3.13 M:\\claud_projects\\temp\\optiland-xcheck\\.venv
    set VIRTUAL_ENV=M:\\claud_projects\\temp\\optiland-xcheck\\.venv
    uv pip install numpy scipy pandas pyyaml typing-extensions tabulate ^
        matplotlib numba vtk seaborn requests
    uv pip install --no-deps optiland==0.6.1
    M:\\claud_projects\\temp\\optiland-xcheck\\.venv\\Scripts\\python ^
        docs\\notes\\optiland-crosscheck.py ^
        packages\\core\\test\\fixtures\\optiland-crosscheck.json

`--no-deps` here buys much less than it did for rayoptics, and the reason is
worth stating so nobody trims the list above and gets an ImportError:
`optiland/__init__.py` imports the visualization stack eagerly, so matplotlib,
numba, vtk and seaborn are load-bearing at IMPORT time even though this script
draws nothing. Only the optional `[gui]` extra (pyside6, qtconsole) is avoidable.

Verified: run from the path above, this script reproduces the committed fixture
byte for byte.

THE REFERENCE. Optiland 0.6.1 (Kramer Harrison, MIT, DOI 10.5281/zenodo.14588961).
Lineage checked before anything was built on it, because a third vote that is a
transcription of the second is not a vote: no module in the wheel mentions
rayoptics, ray-optics, Hayford or opticalglass. Its file-format readers name
Zemax, OSLO and CODE V, which is import plumbing and not trace math.

THE DESIGN IS § 0'S, UNCHANGED: compare the primitive, not the workflow. The
surfaces are built directly as `optiland.surfaces.Surface` objects over
hand-made `CoordinateSystem`s and `IdealMaterial` indices, and traced by
`SurfaceGroup.trace(RealRays(...))` — a ray given as a point and a direction.
No `Optic`, no aperture/field/wavelength specification, no pupil coordinate, no
ray aiming, no image plane, no glass catalog. Optiland records every surface's
hit point and direction cosines in the GLOBAL frame (`localize → intersect →
globalize → record`), so unlike rayoptics there are no per-interface vertex
offsets to add back.

CONVENTIONS THAT HAD TO BE HANDLED, and each is a way this could have reported
a difference that was not one:

  (i) `EvenAsphere.coefficients` start at r^2 where `asphereCoeffs` start at
      r^4 — the same prepended zero rayoptics needed, arrived at independently.

  (ii) `SurfaceGroup.__init__` calls `_update_surface_links()`, which sets
      surface 0's `previous_surface` to None. `Surface.material_pre` then falls
      back to the surface's OWN `material_post`, so the first surface refracts
      n->n (i.e. not at all) and the launch segment's path length is measured in
      glass. It traces cleanly and answers wrongly, which is the worst kind of
      convention, so the object medium is re-attached after construction and
      then ASSERTED against the fixture's `objectIndex` before any ray is
      traced. `SurfaceGroup.reset()` does not re-link, so the attachment holds.

  (iii) Optiland's Newton tolerance is its own: `NewtonRaphsonGeometry` stops at
      max |sag(x, y) - z| < tol over the whole batch, default 1e-10. That is a
      looser floor than the 1e-12 the engine and rayoptics both promise, so it
      is set to 1e-12 here — the same PROMISE, not the same criterion, and the
      residual actually achieved is measured below and printed.

  (iv) Path length accumulates as `rays.opd += abs(t * n)` — the ABSOLUTE
      geometric distance. That is only the physical path while no ray
      back-tracks within a segment, which holds for every ray here (each
      segment is a forward step along the beam, including the -z segments after
      a mirror). The Cassegrain agreeing to the last bits is the evidence.

TILT AND DECENTER, and this is the finding. Optiland's `CoordinateSystem`
builds its rotation as Rz(rz)·Ry(ry)·Rx(rx). With rz = 0 that is Ry·Rx —
Telemicroscope's own spelling, angle for angle, both right-handed. Where
rayoptics needed a matrix solve and a derived Euler triple (its
Rx(-alpha)·Ry(-beta)·Rz(gamma) is a different two-parameter family), this
fixture states `tiltXDeg` as rx and `tiltYDeg` as ry and stops. So the engine's
tilt parameterization is not idiosyncratic: an independent implementation spells
it identically. Nothing here ASSUMES that — the fixture is compared surface by
surface, and § 0's negative controls (tilt-y at -3 deg for the sign, tilt-xy at
12/9 deg for the order) fail if it is wrong.

TWO CONSTRUCTIONS, and which system gets which is the scope note.

  * CHAINED (the twelve unfolded systems, eight of them misaligned). Surface i's
    `CoordinateSystem` carries `reference_cs = ` surface (i-1)'s, a translation
    of (decenterX, decenterY, thickness_{i-1}) and the tilt as (rx, ry). OPTILAND
    COMPOSES THE CHAIN — `get_effective_transform()` walks the references — so
    the frames written out are its own answer about where the glass is, and the
    TypeScript side compares them against `compile()`'s. That is independent
    evidence for the local coordinate chain, from a second source.

  * ABSOLUTE (the four folded systems). Optiland has NO fold concept: a
    `CoordinateSystem` is a placement, a mirror is an interaction, and nothing
    in the library reverses a chain. So the folded systems are placed by
    absolute frame, computed here, and the frames are deliberately NOT written
    to the fixture — comparing `compile()` against frames this script derived
    would be checking a transcription against its source, which is a
    code-duplication check wearing a cross-validation's clothes.

    What the folded four DO vote on is the beam. Optiland traces through this
    placement and must reproduce rayoptics' hit points, its per-surface exit
    directions and its path lengths — and a placement rule that were wrong could
    not do that. The rung is the rays, and the scope note says so.

THE FOLD RULE USED HERE is one X-FLIP per mirror, and it is a second, simpler
reconciliation than § 0.3's. The engine's folded chain frame after a mirror is
the reflection of the frame the light arrived in, which is left-handed;
Optiland's Euler angles can only express a rotation. Restoring right-handedness
by negating the frame's x axis (rather than its z, which is what rayoptics'
convention amounts to) keeps +z on the beam, so curvature, conic, thickness and
asphere coefficients are all used EXACTLY as the prescription writes them, and
no parity flip appears anywhere below. Only a misalignment would conjugate —
and no system has one behind an odd mirror count, so that branch is not written
as untested code: it raises.

DELIBERATELY OUT OF SCOPE. The aimed chief rays of § 0.2 — that is a question
about two solvers, and the majority claim does not need a third one. No new
systems and no new rays: adding either would force the rayoptics fixture to be
regenerated to keep the two answering identical questions, which is a different
and much larger change than this one.
"""

import json
import math
import os
import sys

import numpy as np
import optiland
from optiland.coordinate_system import CoordinateSystem
from optiland.geometries import EvenAsphere, Plane, StandardGeometry
from optiland.interactions.refractive_reflective_model import RefractiveReflectiveModel
from optiland.materials import IdealMaterial
from optiland.rays.real_rays import RealRays
from optiland.surfaces.standard_surface import Surface
from optiland.surfaces.surface_group import SurfaceGroup

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SOURCE_FIXTURE = os.path.join(
    REPO, "packages", "core", "test", "fixtures", "rayoptics-crosscheck.json"
)

#: Newton stopping criterion handed to every iterated geometry — see (iii).
NEWTON_TOL = 1e-12

#: Right-multiplying a frame by this negates its x axis and leaves +z on the
#: beam. One per mirror is the whole of the folded reconciliation here.
X_FLIP = np.diag([-1.0, 1.0, 1.0])

#: Worst |Rz·Ry·Rx − R| over every absolutely-placed surface. A frame is handed
#: to Optiland as Euler angles, so the extraction is checked against the matrix
#: it came from before anything is traced.
EULER_ROUNDTRIP_MAX = 1e-12

#: Worst achieved |sag − z| on the asphere, filled in by the trace and printed.
ASPHERE_RESIDUALS = []
EULER_RESIDUALS = []


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def tilt_matrix(surface):
    """Ry(tiltY)·Rx(tiltX) — the prescription's own spelling."""
    return rot_y(math.radians(surface.get("tiltYDeg", 0.0))) @ rot_x(
        math.radians(surface.get("tiltXDeg", 0.0))
    )


def euler_zyx(R):
    """rx, ry, rz with Rz(rz)·Ry(ry)·Rx(rx) == R, in Optiland's convention."""
    ry = math.asin(max(-1.0, min(1.0, -R[2, 0])))
    rx = math.atan2(R[2, 1], R[2, 2])
    rz = math.atan2(R[1, 0], R[0, 0])
    return rx, ry, rz


def absolute_frames(sysdef):
    """Where a folded system's surfaces actually sit, as right-handed frames.

    The chain frame after a mirror is the incoming frame reflected in the
    mirror's tangent plane, made right-handed again by the x flip. Everything
    else — the decenter applied in the incoming frame, the tilt about the
    displaced vertex, the thickness along the outgoing +z — is the ordinary
    local coordinate chain.
    """
    chain = np.eye(3)
    vertex = np.zeros(3)
    mirrors = 0
    out = []
    for s in sysdef["surfaces"]:
        if mirrors % 2 == 1 and (s.get("tiltYDeg") or s.get("decenterX")):
            # The x flip conjugates a downstream misalignment: tiltY and
            # decenterX would change sign behind an odd number of mirrors.
            # No fixture system does this, so rather than ship the branch
            # untested, refuse it — see the header.
            raise NotImplementedError(
                f"{sysdef['id']}: a tiltY or decenterX behind an odd mirror count "
                "needs the x-flip conjugation, which no system exercises"
            )
        frame = chain @ tilt_matrix(s)
        here = vertex + chain @ np.array(
            [s.get("decenterX", 0.0), s.get("decenterY", 0.0), 0.0]
        )
        out.append((frame, here))
        if s.get("reflect"):
            normal = frame[:, 2]
            reflection = np.eye(3) - 2.0 * np.outer(normal, normal)
            chain = reflection @ chain @ X_FLIP
            mirrors += 1
        else:
            chain = frame
        vertex = here + chain @ np.array([0.0, 0.0, s["thickness"]])
    return out


def geometry_for(surface, cs):
    c = surface.get("curvature", 0.0)
    radius = np.inf if c == 0.0 else 1.0 / c
    conic = surface.get("conic", 0.0)
    coeffs = surface.get("asphereCoeffs")
    if coeffs:
        # (i) Optiland's coefficients start at r^2; ours start at r^4.
        return EvenAsphere(
            cs, radius, conic, tol=NEWTON_TOL, coefficients=[0.0] + list(coeffs)
        )
    if radius == np.inf and conic == 0.0:
        return Plane(cs)
    return StandardGeometry(cs, radius, conic)


def coordinate_systems(sysdef):
    """One CoordinateSystem per surface, plus how they were placed."""
    surfaces = sysdef["surfaces"]
    if sysdef.get("mirrorFrames") == "folded":
        systems = []
        for R, vertex in absolute_frames(sysdef):
            rx, ry, rz = euler_zyx(R)
            cs = CoordinateSystem(
                x=float(vertex[0]),
                y=float(vertex[1]),
                z=float(vertex[2]),
                rx=rx,
                ry=ry,
                rz=rz,
            )
            residual = float(np.max(np.abs(np.asarray(cs.get_rotation_matrix()) - R)))
            EULER_RESIDUALS.append((sysdef["id"], residual))
            if residual > EULER_ROUNDTRIP_MAX:
                raise AssertionError(
                    f"{sysdef['id']}: Euler extraction off by {residual:.3e}"
                )
            systems.append(cs)
        return systems, "absolute"

    systems = []
    reference = None
    for i, s in enumerate(surfaces):
        cs = CoordinateSystem(
            x=s.get("decenterX", 0.0),
            y=s.get("decenterY", 0.0),
            z=0.0 if i == 0 else surfaces[i - 1]["thickness"],
            rx=math.radians(s.get("tiltXDeg", 0.0)),
            ry=math.radians(s.get("tiltYDeg", 0.0)),
            rz=0.0,
            reference_cs=reference,
        )
        systems.append(cs)
        reference = cs
    return systems, "chain"


def build(sysdef):
    """The SurfaceGroup, how it was placed, and the object surface."""
    surfaces = sysdef["surfaces"]
    n_obj = sysdef["objectIndex"]
    systems, placement = coordinate_systems(sysdef)

    # (ii) The object medium lives on a surface that is never traced: it exists
    # only so that surface 0 has a `material_pre` other than its own glass.
    obj = Surface(
        previous_surface=None,
        material_post=IdealMaterial(n=n_obj),
        geometry=Plane(CoordinateSystem()),
    )

    built = []
    previous = obj
    n_before = n_obj
    for i, s in enumerate(surfaces):
        reflect = bool(s.get("reflect", False))
        n_after = n_before if reflect else s["indexAfter"]
        surface = Surface(
            previous_surface=previous,
            material_post=IdealMaterial(n=n_after),
            geometry=geometry_for(s, systems[i]),
        )
        if reflect:
            surface.interaction_model = RefractiveReflectiveModel(
                parent_surface=surface, is_reflective=True
            )
        built.append(surface)
        previous = surface
        n_before = n_after

    group = SurfaceGroup(built)
    # ...and re-attached AFTER construction, because SurfaceGroup re-links.
    built[0].previous_surface = obj
    return group, placement, built


def trace(sysdef, wavelength_um):
    group, placement, built = build(sysdef)

    got = float(built[0].material_pre.n(wavelength_um))
    if got != sysdef["objectIndex"]:
        raise AssertionError(
            f"{sysdef['id']}: object medium is {got}, fixture says "
            f"{sysdef['objectIndex']} — surface 0 would refract into itself"
        )

    origins = np.array([r["origin"] for r in sysdef["rays"]], dtype=float)
    dirs = np.array([r["dir"] for r in sysdef["rays"]], dtype=float)
    rays = RealRays(
        origins[:, 0],
        origins[:, 1],
        origins[:, 2],
        dirs[:, 0],
        dirs[:, 1],
        dirs[:, 2],
        np.ones(len(origins)),
        np.full(len(origins), wavelength_um),
    )
    group.trace(rays)

    x, y, z = np.asarray(group.x), np.asarray(group.y), np.asarray(group.z)
    L, M, N = np.asarray(group.L), np.asarray(group.M), np.asarray(group.N)
    opd = np.asarray(group.opd)
    n_surf = len(sysdef["surfaces"])

    # (iii) how close the iteration actually got, on the one surface that has
    # no closed-form intersection.
    for i, s in enumerate(sysdef["surfaces"]):
        if not s.get("asphereCoeffs"):
            continue
        geom = built[i].geometry
        local = RealRays(
            x[i].copy(), y[i].copy(), z[i].copy(), L[i], M[i], N[i], np.ones(len(x[i])), 0.0
        )
        geom.localize(local)
        residual = float(
            np.max(np.abs(np.asarray(geom.sag(local.x, local.y)) - np.asarray(local.z)))
        )
        ASPHERE_RESIDUALS.append((sysdef["id"], i, residual))

    expected = []
    for j in range(len(origins)):
        hits = [[float(v) for v in origins[j]]]
        seg_dirs = []
        for i in range(n_surf):
            hits.append([float(x[i, j]), float(y[i, j]), float(z[i, j])])
            seg_dirs.append([float(L[i, j]), float(M[i, j]), float(N[i, j])])
        expected.append(
            {
                "point": hits[-1],
                "dir": seg_dirs[-1],
                "opl": float(opd[n_surf - 1, j]),
                "hits": hits,
                "segDirs": seg_dirs,
            }
        )

    out = {
        "id": sysdef["id"],
        "placement": placement,
        "objectIndex": sysdef["objectIndex"],
        "surfaces": sysdef["surfaces"],
        "rays": sysdef["rays"],
        "expected": expected,
    }
    if "mirrorFrames" in sysdef:
        out["mirrorFrames"] = sysdef["mirrorFrames"]
    if placement == "chain":
        # Optiland's own answer about where the glass is: it walked the
        # reference chain to get here, this script did not.
        frames = []
        for cs in coordinate_systems(sysdef)[0]:
            translation, rotation = cs.get_effective_transform()
            frames.append(
                {
                    "rotation": [float(v) for v in np.asarray(rotation).reshape(9)],
                    "vertex": [float(v) for v in np.asarray(translation).reshape(3)],
                }
            )
        out["frames"] = frames
    return out


def main():
    with open(SOURCE_FIXTURE, encoding="utf8") as fh:
        source = json.load(fh)

    wavelength_nm = source["wavelengthNm"]
    wavelength_um = wavelength_nm / 1000.0

    systems = [trace(s, wavelength_um) for s in source["systems"]]

    out = {
        "_generator": {
            "tool": "optiland",
            "version": optiland.__version__,
            "python": ".".join(str(v) for v in sys.version_info[:3]),
            "numpy": np.__version__,
            "backend": "numpy (float64)",
            "call": (
                "optiland.surfaces.SurfaceGroup.trace(RealRays(...)) over "
                "hand-built Surface/CoordinateSystem/IdealMaterial, "
                f"NewtonRaphsonGeometry(tol={NEWTON_TOL:g})"
            ),
            "script": "docs/notes/optiland-crosscheck.py",
            "inputsFrom": "packages/core/test/fixtures/rayoptics-crosscheck.json",
        },
        "wavelengthNm": wavelength_nm,
        "systems": systems,
    }

    path = sys.argv[1] if len(sys.argv) > 1 else "fixture.json"
    with open(path, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", path)
    for s in systems:
        print(
            s["id"],
            s["placement"],
            len(s["rays"]),
            "rays; last hit",
            [round(v, 9) for v in s["expected"][-1]["point"]],
        )
    if EULER_RESIDUALS:
        worst = max(EULER_RESIDUALS, key=lambda r: r[1])
        print(
            f"Euler extraction, worst residual: {worst[1]:.3e} on {worst[0]} "
            f"(bound {EULER_ROUNDTRIP_MAX:.0e})"
        )
    for name, i, residual in ASPHERE_RESIDUALS:
        print(
            f"asphere Newton residual on {name} surface {i}: {residual:.3e} mm "
            f"(promised {NEWTON_TOL:.0e})"
        )


if __name__ == "__main__":
    main()
