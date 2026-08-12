"""Generate the rayoptics cross-check fixture.

Traces a fixed list of explicitly-specified rays through a fixed list of
explicitly-specified systems, using rayoptics' own raw ray trace, and writes
both the inputs and rayoptics' answers to one JSON file. The TypeScript side
rebuilds the same systems from the same file and compares.

This script is NOT run by `npm test`, and must not be: the fixture it writes is
the external number, so it is committed and the suite reads it directly. The
script is here so the number can be re-derived and argued with, which is the
whole point of a cross-validation.

Regenerating (Python >= 3.12, which is what rayoptics 0.9.9 requires). Windows
paths, since that is this project's platform; use bin/ instead of Scripts/
elsewhere. The venv is built OUTSIDE the repo on purpose — a 200 MB tree of
someone else's wheels is not this project's working directory:

    uv venv --python 3.13 M:\\claud_projects\\temp\\rayoptics-xcheck\\.venv
    uv pip install numpy scipy pandas matplotlib anytree parsimonious ^
        transforms3d requests json_tricks deprecation traitlets opticalglass
    uv pip install --no-deps rayoptics==0.9.9
    M:\\claud_projects\\temp\\rayoptics-xcheck\\.venv\\Scripts\\python ^
        docs\\notes\\rayoptics-crosscheck.py ^
        packages\\core\\test\\fixtures\\rayoptics-crosscheck.json

`--no-deps` with the list spelled out, rather than a plain `pip install
rayoptics`, because rayoptics' full dependency set drags in a Qt/IPython desktop
stack (pyside6, qtconsole, ipywidgets, ipython) — some 200 MB that this script
never imports, since it drives the sequential model and the ray trace directly
and draws nothing.

Verified: run from the path above, this script reproduces the committed fixture
byte for byte. Then run `npm test` — the version assertion in
crosscheck.test.ts fails first if a different rayoptics wrote the file, which is
deliberate: a reference that silently changes underneath is not a reference.

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

TILT AND DECENTER. The two programs agree on the *structure* and disagree on
the *parameters*, so this file reconciles them by comparing frames rather than
angles.

Structure, and it is the same on both sides. rayoptics' `DecenterData` type
'decenter' is "pos and orientation applied prior to surface", never returned to
the global axis; `elem.transform.forward_transform` then builds the step from
surface i to surface i+1 as [0, 0, thickness_i] taken along surface i's OWN
(already tilted) local z, plus surface i+1's decenter in that same frame, with
surface i+1's rotation about the decentered vertex. That is exactly
Telemicroscope's local coordinate chain (`trace/compile.ts`, and the semantics
decision in docs/ARCHITECTURE.md): translate the vertex in the incoming frame,
rotate about it, and advance the next thickness along the tilted result. The
"tilt about the vertex and return to the global axis" idiom — rayoptics' 'dec
and return' — is the one ARCHITECTURE rejects, and it is not used here.

Parameters, and they are NOT the same. Telemicroscope builds a surface's
rotation as Ry(tiltY)·Rx(tiltX) — X first, then Y, both right-handed.
rayoptics' `misc_math.euler2rot3d` negates its first two Euler angles
(`euler2opt`, "alpha and beta are left-handed") and multiplies them in the
intrinsic x-y-z order, giving Rx(-alpha)·Ry(-beta)·Rz(gamma). Those are
different two-parameter families: for a single-axis tilt they coincide with a
sign flip, and for a two-axis tilt they do not coincide at all, because Ry·Rx
is not Rx·Ry.

So the fixture states the tilt in Telemicroscope's parameters, builds the
rotation matrix they mean, and asks rayoptics for the Euler triple that
realizes THAT MATRIX (`transforms3d.euler.mat2euler(..., axes='rxyz')`, then
un-doing euler2opt). The triple is a derived quantity, checked here against the
matrix it came from before anything is traced — `ROT_ROUNDTRIP_MAX` below is
the worst residual over every system, and it is at the rounding floor. Nothing
about the ray comparison depends on the two programs spelling a tilt the same
way; it depends on them putting the surface in the same place, which is why
each system also carries the frames rayoptics actually traced through, in the
launch frame, for the TypeScript side to compare against its own compiled ones.

AIMED CHIEF RAYS — the external number for real ray aiming (VALIDATION
§ 1.5.3). Each misaligned system also carries the ray that, coming from a
stated direction, lands on a stated surface's OWN VERTEX. That target is
chosen because it needs no convention: a vertex is a point on a surface, where
a rim point at "40% across the stop" would first require both sides to agree
what a pupil coordinate means on a tilted stop.

Both sides solve it, and neither imports the other's solver. Here it is a
two-variable Newton on the launch offset, wrapped around rayoptics' own raw
trace; in the engine it is `aimRay` with `rayAiming: "real"`. So the comparison
is two independent solvers driving two independent tracers to the same
geometric condition — which is a stronger statement than either program's
aiming being checked against a formula, and a different one from the rest of
this file, where no aiming enters at all.

Only the CHIEF ray is pinned this way. The rim of the pupil is covered by the
rigid-motion identities in `real-aiming.test.ts`, for the convention reason
above.

TILTED MIRRORS AND THE FOLDED FRAME — the third investigation, and the last
thing this file used to name as open. Five more systems: one misaligned mirror
under the default (unfolded) chain, and four folded ones.

The unfolded half needs nothing new. A tilted mirror under `mirrorFrames:
"unfolded"` is a misalignment like any other — the chain keeps its direction,
the thickness after it stays negative, and rayoptics' `DecenterData('decenter')`
places it exactly as the refracting systems above are placed. So
`tilted-secondary-cassegrain` is built the same way they are.

The folded half is a second convention, and it reconciles by ONE RULE. Write
`parity` for (-1)^(mirrors so far). A folded prescription and the model built
here are the same world geometry read in frames that differ by a z-flip per
mirror, D = diag(1, 1, -1):

    frame_rayoptics(i) = frame_engine(i) . D^(mirrors before i)

Everything else follows from what D does to each field. It negates z, so a
curvature and an even-asphere coefficient — which are the sag, and the sag is
along z — carry `parity`, while a conic constant (a shape parameter) and a
decenter (an (x, y, 0) shift) do not. A thickness carries the parity AFTER its
own surface, which is why post-mirror thicknesses are positive in a folded
prescription and negative in the model built here. And a tilt matrix
conjugates: rayoptics is handed D.T.D after an odd number of mirrors, which for
this engine's in-plane tilt axes is simply the two angles negated.

Where rayoptics has its own fold concept, it is used rather than emulated:
`DecenterData('bend')` — "orientation applied before and after surface" — is
what a tilted fold mirror is built with, so the frames the comparison agrees on
are the ones rayoptics' own fold produced, not ones this script dictated.

THE ONE PLACE THE TWO FOLD RULES PART, and it is a finding rather than a defect
on either side. 'bend' applies the tilt rotation T twice; this engine reflects
the incoming frame in the tangent plane, which is T.D.T^T read in the same
frame. Those agree exactly when D.T.D = T^T — whenever T is a rotation about an
axis in the xy-plane, which is every single-axis tilt and so every fold mirror
that is actually a fold mirror. A TWO-axis tilt is not such a rotation (Ry.Rx
carries a roll), and there the two rules differ: at 45 deg in x with 3 deg in y
the chains part by 0.88 deg. Which one follows the light is settled by
rayoptics' OWN RAY TRACE rather than by argument — the beam leaves along the
reflected frame's axis to the last bit, and 0.88 deg away from 'bend'. So this
script asserts the coincidence before it uses 'bend' anywhere, and the one
system carrying a compound tilt puts the mirror LAST, where nothing downstream
needs a chain and rayoptics builds it as a plain 'decenter'.

Per-segment directions (`segDirs`) are dumped for every system, not just the
folded ones: the final direction alone cannot see an error that cancels between
two surfaces, and the folded rungs need the direction the beam left a MIRROR in
to compare against the frame the chain continues in.

Not covered, and named rather than half-done: no aimed chief ray is solved on a
folded system. That would pull in pupils and the unfolded-axis map, which is a
different rung (§ 1.5.3, and `fold.test.ts`) from the convention this block is
about.
"""
import json
import math
import sys

import numpy as np
import transforms3d as t3d
import rayoptics
from rayoptics.optical.opticalmodel import OpticalModel
from rayoptics.elem.profiles import Conic, EvenPolynomial
from rayoptics.elem.surface import DecenterData
from rayoptics.raytr import raytrace
from rayoptics.util.misc_math import euler2rot3d
from opticalglass.opticalmedium import ConstantIndex

WVL = 587.5618

# Worst |Δ| seen while converting a Telemicroscope rotation into the Euler
# triple rayoptics needs and back again. Reported by main() and asserted there:
# a convention translation that is not exact is a term in the comparison.
ROT_ROUNDTRIP_MAX = 4e-16
ROT_RESIDUALS = []

# The z-flip that relates the two mirror-frame conventions. A folded chain's
# +z follows the light; rayoptics' runs backwards after every mirror, exactly
# as an unfolded prescription's negative thicknesses do.
DFLIP = np.diag([1.0, 1.0, -1.0])

# How far rayoptics' own 'bend' may sit from the reflected frame before this
# script refuses to use it. The two coincide identically for a tilt about an
# in-plane axis, so this is a rounding bound and not a tolerance.
BEND_COINCIDENCE_MAX = 1e-15
BEND_RESIDUALS = []

# Indices Telemicroscope's catalog reports at WVL (packages/core/src/materials).
N_AIR = 1.0
N_BK7 = 1.5168000345005883
N_F2 = 1.6200401372462678


# --- tilt: Telemicroscope's parameters, rayoptics' realization ---------------

def _rot_x(rad):
    c, s = math.cos(rad), math.sin(rad)
    return np.array([[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]])


def _rot_y(rad):
    c, s = math.cos(rad), math.sin(rad)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def engine_rotation(surface):
    """The rotation Telemicroscope's `tiltRotation` builds: Ry(tiltY)·Rx(tiltX)."""
    tx = math.radians(surface.get('tiltXDeg', 0.0))
    ty = math.radians(surface.get('tiltYDeg', 0.0))
    return _rot_y(ty) @ _rot_x(tx)


def rayoptics_euler(rot):
    """The (alpha, beta, gamma) in degrees whose `euler2rot3d` is `rot`.

    rayoptics composes Rx(-alpha)·Ry(-beta)·Rz(gamma) (intrinsic x-y-z, with
    the first two angles left-handed), so the triple comes from an intrinsic
    x-y-z decomposition with the first two negated. Solving for the matrix
    rather than translating the angles is the whole point: a two-axis tilt has
    no angle-for-angle translation, because Ry·Rx is not Rx·Ry.
    """
    a, b, g = t3d.euler.mat2euler(rot, axes='rxyz')
    return (-math.degrees(a), -math.degrees(b), math.degrees(g))


def is_misaligned(surface):
    return any(surface.get(k) for k in
               ('tiltXDeg', 'tiltYDeg', 'decenterX', 'decenterY'))


def is_tilted(surface):
    return bool(surface.get('tiltXDeg') or surface.get('tiltYDeg'))


def is_folded(system):
    return system.get('mirrorFrames') == 'folded'


def parities(system):
    """(-1)^(mirrors so far), one entry per surface BOUNDARY.

    `p[i]` is the parity in front of surface i and `p[i+1]` the parity behind
    it, so a curvature reads `c * p[i]` and the thickness that follows it reads
    `t * p[i+1]`. Unfolded systems are all +1 — their author already wrote the
    negative thicknesses, and nothing about them moves.
    """
    folded = is_folded(system)
    out, p = [1], 1
    for s in system['surfaces']:
        if folded and s.get('reflect'):
            p = -p
        out.append(p)
    return out


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

# --- the misaligned systems --------------------------------------------------
# One shape, perturbed one degree of freedom at a time. Combining tilt with
# decenter, or X with Y, in the system that first exercises them would let a
# sign error and an order error cancel and call the result agreement; each
# system below therefore names exactly what it moves, and the two systems that
# DO combine (tilt-xy, tilt-and-decenter) exist precisely because a combination
# is the only thing that can see an ordering.

SINGLET = [
    {"curvature": 0.02, "thickness": 6.0, "indexAfter": N_BK7},
    {"curvature": -0.015, "thickness": 0.0, "indexAfter": N_AIR},
]

# Skew rays (x != 0) throughout: a meridional-only ray set cannot see a sign
# error in a Y tilt, because it never leaves the plane the tilt acts in.
SINGLET_RAYS = (
    [{"origin": [0.0, h, -30.0], "dir": [0.0, 0.0, 1.0]} for h in (0.0, 4.0, 8.0, 12.0, -10.0)]
    + [{"origin": [0.0, h, -30.0],
        "dir": [0.0, math.sin(math.radians(0.8)), math.cos(math.radians(0.8))]}
       for h in (-6.0, 6.0)]
    + [
        {"origin": [7.0, -9.0, -30.0], "dir": [0.0, 0.0, 1.0]},
        {"origin": [-5.0, 4.0, -30.0],
         "dir": [math.sin(math.radians(0.5)), math.sin(math.radians(-0.35)),
                 math.sqrt(1 - math.sin(math.radians(0.5))**2
                           - math.sin(math.radians(0.35))**2)]},
    ]
)


def misaligned_singlet(sid, note, index, **perturbation):
    surfaces = [dict(s) for s in SINGLET]
    surfaces[index].update(perturbation)
    return {"id": sid, "note": note, "objectIndex": N_AIR,
            "surfaces": surfaces, "rays": SINGLET_RAYS,
            # the aimed chief ray: onto the rear surface's own vertex, which is
            # the surface the perturbation is on, so the target itself moves
            "aim": {"stopSurface": 1, "fieldDeg": 0.4, "launchZ": -30.0}}


def misaligned_achromat():
    """The one system with surfaces DOWNSTREAM of a tilt.

    A single tilted surface cannot distinguish the local coordinate chain from
    the tilt-and-return idiom: there is nothing after it to be steered. Here
    surface 0 is tilted and two surfaces follow it, so the whole rear of the
    doublet rides on the tilted frame — and surface 1 is decentered inside that
    frame, which is the only place a decenter composed with an upstream
    rotation is exercised.
    """
    base = SYSTEMS[0]
    surfaces = [dict(s) for s in base["surfaces"]]
    surfaces[0].update({"tiltXDeg": 2.0, "tiltYDeg": 1.5})
    surfaces[1].update({"decenterY": 0.25})
    return {
        "id": "misaligned-achromat",
        "note": "SYSTEMS[0]'s cemented doublet with surface 0 tilted 2 deg in X and "
                "1.5 deg in Y and surface 1 decentered 0.25 mm in Y. Everything after "
                "surface 0 rides on its tilted frame — the local coordinate chain.",
        "objectIndex": N_AIR,
        "surfaces": surfaces,
        "rays": base["rays"],
        # onto the LAST surface's vertex, so the aim is solved through both the
        # tilt on surface 0 and the decenter on surface 1
        "aim": {"stopSurface": 2, "fieldDeg": 0.25, "launchZ": -50.0},
    }


SYSTEMS += [
    misaligned_singlet(
        "decenter-x",
        "Rear surface shifted 0.8 mm in X alone. No tilt, no Y: a sign or axis "
        "error in the decenter has nothing to hide behind.",
        1, decenterX=0.8),
    misaligned_singlet(
        "decenter-y",
        "Rear surface shifted -0.6 mm in Y alone, and negative so the sign is "
        "exercised rather than assumed.",
        1, decenterY=-0.6),
    misaligned_singlet(
        "tilt-x",
        "Rear surface tilted 4 deg about X alone. Single-axis, so this is the one "
        "case where the two programs' tilt parameters do translate angle for "
        "angle (with rayoptics' left-handed sign).",
        1, tiltXDeg=4.0),
    misaligned_singlet(
        "tilt-y",
        "Rear surface tilted -3 deg about Y alone.",
        1, tiltYDeg=-3.0),
    misaligned_singlet(
        "tilt-xy",
        "Rear surface tilted 12 deg about X AND 9 deg about Y. The only system "
        "that can tell Ry.Rx from Rx.Ry, and the angles are large on purpose: at "
        "0.1 deg the two orderings differ by less than the tolerance and the "
        "system would pass either way.",
        1, tiltXDeg=12.0, tiltYDeg=9.0),
    misaligned_singlet(
        "tilt-and-decenter",
        "Rear surface tilted 5 deg about X and shifted (0.7, -0.5) mm in the same "
        "step. The only system that can tell 'shift the vertex, then rotate about "
        "it' from 'rotate, then shift along the rotated axes'.",
        1, tiltXDeg=5.0, decenterX=0.7, decenterY=-0.5),
    misaligned_achromat(),
]

# --- tilted mirrors, and the folded frame ------------------------------------
# Ray 0 of every folded system is EXACTLY axial, and that is load-bearing: it
# arrives at each mirror's vertex along the chain's own axis, so the direction
# it leaves in is the direction the chain must continue in. That single ray is
# what pins the fold rule against a beam rather than against another frame.

SYSTEMS += [
    {
        "id": "tilted-secondary-cassegrain",
        "note": "SYSTEMS[2]'s Cassegrain with the secondary tilted 0.4 deg in X and "
                "-0.25 deg in Y and decentered 0.5 mm in X, plus a flat 700 mm behind "
                "it. UNFOLDED — a tilted mirror as a MISALIGNMENT: the chain keeps its "
                "direction, the thickness after the mirror stays negative, and the flat "
                "rides on the secondary's tilted frame. No new convention, and the first "
                "system here where a REFLECTING surface is the one that moved.",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": -0.000625, "conic": -1.0, "thickness": -560.0, "reflect": True},
            {"curvature": -0.00125, "conic": -5.4444444444444455, "thickness": 700.0,
             "reflect": True, "tiltXDeg": 0.4, "tiltYDeg": -0.25, "decenterX": 0.5},
            {"curvature": 0.0, "thickness": 0.0, "indexAfter": N_AIR},
        ],
        "rays": SYSTEMS[2]["rays"],
    },
    {
        "id": "fold-flat-45",
        "note": "FOLDED. A 45 deg flat steering the chain by 90 deg, then a plano-convex "
                "lens 100 mm along the folded axis. The lens is the point: its curvature "
                "sits behind an odd number of mirrors, so the fixture's +0.01 is -0.01 in "
                "the model rayoptics traces, and getting that parity wrong would put the "
                "power on the wrong side of the glass.",
        "mirrorFrames": "folded",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": 0.0, "thickness": 100.0, "reflect": True, "tiltXDeg": 45.0},
            {"curvature": 0.01, "thickness": 6.0, "indexAfter": N_BK7},
            {"curvature": 0.0, "thickness": 0.0, "indexAfter": N_AIR},
        ],
        "rays": (
            [{"origin": [0.0, 0.0, -50.0], "dir": [0.0, 0.0, 1.0]}]
            + [{"origin": [0.0, h, -50.0], "dir": [0.0, 0.0, 1.0]} for h in (6.0, 12.0, -10.0)]
            + [{"origin": [x, 0.0, -50.0], "dir": [0.0, 0.0, 1.0]} for x in (8.0, -14.0)]
            + [{"origin": [0.0, h, -50.0],
                "dir": [0.0, math.sin(math.radians(0.5)), math.cos(math.radians(0.5))]}
               for h in (0.0, 10.0)]
            + [
                {"origin": [7.0, -9.0, -50.0], "dir": [0.0, 0.0, 1.0]},
                {"origin": [-5.0, 4.0, -50.0],
                 "dir": [math.sin(math.radians(0.4)), math.sin(math.radians(-0.3)),
                         math.sqrt(1 - math.sin(math.radians(0.4))**2
                                   - math.sin(math.radians(0.3))**2)]},
            ]
        ),
    },
    {
        "id": "newtonian-fold",
        "note": "FOLDED. The system the convention exists for: a paraboloid of f = 1000 "
                "(R = -2000), a 45 deg diagonal 800 mm up the tube, and a flat at the "
                "eyepiece 200 mm out the side. TWO mirrors, so the parity returns — and "
                "the diagonal's tilt sits behind an odd number of them, which is the one "
                "place the conjugated tilt matrix D.T.D is exercised.",
        "mirrorFrames": "folded",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": -0.0005, "conic": -1.0, "thickness": 800.0, "reflect": True},
            {"curvature": 0.0, "thickness": 200.0, "reflect": True, "tiltXDeg": 45.0},
            {"curvature": 0.0, "thickness": 0.0, "indexAfter": N_AIR},
        ],
        "rays": (
            [{"origin": [0.0, 0.0, -2000.0], "dir": [0.0, 0.0, 1.0]}]
            + [{"origin": [0.0, h, -2000.0], "dir": [0.0, 0.0, 1.0]} for h in (30.0, 60.0, -80.0)]
            + [{"origin": [x, 0.0, -2000.0], "dir": [0.0, 0.0, 1.0]} for x in (45.0, -70.0)]
            + [{"origin": [0.0, 50.0, -2000.0],
                "dir": [0.0, math.sin(math.radians(0.05)), math.cos(math.radians(0.05))]}]
            + [
                {"origin": [35.0, 55.0, -2000.0], "dir": [0.0, 0.0, 1.0]},
                {"origin": [-20.0, 25.0, -2000.0],
                 "dir": [math.sin(math.radians(0.03)), math.sin(math.radians(-0.02)),
                         math.sqrt(1 - math.sin(math.radians(0.03))**2
                                   - math.sin(math.radians(0.02))**2)]},
            ]
        ),
    },
    {
        "id": "fold-sphere-15",
        "note": "FOLDED. A CURVED fold: a concave sphere (R = -800) tilted 15 deg about "
                "Y, deviating the chain by 30 deg into the x-z plane, with a meniscus in "
                "the converging beam 300 mm along it. A flat fold cannot see a curvature "
                "parity and a 45 deg one cannot tell an angle from its double, so this "
                "system is neither.",
        "mirrorFrames": "folded",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": -0.00125, "thickness": 300.0, "reflect": True, "tiltYDeg": 15.0},
            {"curvature": 0.002, "thickness": 5.0, "indexAfter": N_BK7},
            {"curvature": -0.0025, "thickness": 0.0, "indexAfter": N_AIR},
        ],
        "rays": (
            [{"origin": [0.0, 0.0, -100.0], "dir": [0.0, 0.0, 1.0]}]
            + [{"origin": [0.0, h, -100.0], "dir": [0.0, 0.0, 1.0]} for h in (20.0, -25.0)]
            + [{"origin": [x, 0.0, -100.0], "dir": [0.0, 0.0, 1.0]} for x in (15.0, -22.0)]
            + [{"origin": [0.0, h, -100.0],
                "dir": [0.0, math.sin(math.radians(0.6)), math.cos(math.radians(0.6))]}
               for h in (0.0, 18.0)]
            + [
                {"origin": [12.0, -16.0, -100.0], "dir": [0.0, 0.0, 1.0]},
                {"origin": [-9.0, 7.0, -100.0],
                 "dir": [math.sin(math.radians(0.5)), math.sin(math.radians(-0.4)),
                         math.sqrt(1 - math.sin(math.radians(0.5))**2
                                   - math.sin(math.radians(0.4))**2)]},
            ]
        ),
    },
    {
        "id": "fold-compound-tilt",
        "note": "FOLDED, and the one system where the two fold rules disagree: a diagonal "
                "tilted 45 deg in X AND 3 deg in Y, behind a singlet. The mirror is LAST "
                "on purpose — rayoptics builds it as a plain 'decenter', because 'bend' "
                "would point the chain 0.88 deg away from where its own trace sends the "
                "beam, and with nothing downstream that chain is never needed. What the "
                "rays pin is the mirror itself; `foldCheck` records the divergence.",
        "mirrorFrames": "folded",
        "objectIndex": N_AIR,
        "surfaces": [
            {"curvature": 0.008, "thickness": 6.0, "indexAfter": N_BK7},
            {"curvature": -0.008, "thickness": 150.0, "indexAfter": N_AIR},
            {"curvature": 0.0, "thickness": 0.0, "reflect": True,
             "tiltXDeg": 45.0, "tiltYDeg": 3.0},
        ],
        "foldCheck": {"surface": 2},
        "rays": (
            [{"origin": [0.0, 0.0, -40.0], "dir": [0.0, 0.0, 1.0]}]
            + [{"origin": [0.0, h, -40.0], "dir": [0.0, 0.0, 1.0]} for h in (5.0, 10.0, -8.0)]
            + [{"origin": [x, 0.0, -40.0], "dir": [0.0, 0.0, 1.0]} for x in (6.0, -11.0)]
            + [{"origin": [0.0, 0.0, -40.0],
                "dir": [0.0, math.sin(math.radians(0.7)), math.cos(math.radians(0.7))]}]
            + [
                {"origin": [4.0, -7.0, -40.0], "dir": [0.0, 0.0, 1.0]},
                {"origin": [-3.0, 5.0, -40.0],
                 "dir": [math.sin(math.radians(0.6)), math.sin(math.radians(-0.45)),
                         math.sqrt(1 - math.sin(math.radians(0.6))**2
                                   - math.sin(math.radians(0.45))**2)]},
            ]
        ),
    },
]


def fold_check(opm, system, frames, expected):
    """What rayoptics' own 'bend' would have done, where it is not what happens.

    Only meaningful on a mirror carrying a compound tilt. `bendAxis` is the
    chain 'bend' produces — the tilt rotation applied twice, light running
    backwards along it as it does after any mirror — and `beamDir` is where
    rayoptics' ray trace actually sent the axial ray. The engine's rule reflects
    the incoming frame instead, and the TypeScript side checks its own
    `outgoingFrame` against `beamDir`, not against either matrix.
    """
    k = system['foldCheck']['surface']
    surface = system['surfaces'][k]
    par = parities(system)
    rot = engine_rotation(surface)
    if par[k] < 0:
        rot = DFLIP @ rot @ DFLIP
    # `frames[k]` already carries the rotation applied BEFORE the surface, so
    # 'bend' — which applies it after as well — would continue the chain in
    # frame . rot, with the light running backwards along it as after any
    # mirror.
    frame = np.array(frames[k]['rotation']).reshape(3, 3)
    bend_axis = -(frame @ rot).dot(np.array([0.0, 0.0, 1.0]))
    beam = np.array(expected[0]['segDirs'][k])
    cosine = float(np.clip(bend_axis.dot(beam), -1.0, 1.0))
    return {
        "surface": k,
        "beamDir": [float(v) for v in beam],
        "bendAxis": [float(v) for v in bend_axis],
        "bendDeviationDeg": math.degrees(math.acos(cosine)),
    }


def build(system):
    opm = OpticalModel(radius_mode=False)
    sm = opm['seq_model']

    # Object interface on surface 0's vertex, so one coordinate origin serves
    # both tracers.
    sm.gaps[0].thi = 0.0
    sm.gaps[0].medium = ConstantIndex(system['objectIndex'], 'obj')

    par = parities(system)
    n_surf = len(system['surfaces'])

    for i, s in enumerate(system['surfaces']):
        # The z-flip rule, one field at a time (see the module docstring). On
        # every unfolded system every parity is +1 and none of this bites.
        p_before, p_after = par[i], par[i + 1]
        sm.add_surface([0.0, s['thickness'] * p_after])
        ifc = sm.ifcs[-2]           # the surface just added (last is the image)
        coefs = s.get('asphereCoeffs')
        curvature = s['curvature'] * p_before
        if coefs:
            # rayoptics coefs start at r^2; Telemicroscope's start at r^4.
            ifc.profile = EvenPolynomial(c=curvature, cc=s.get('conic', 0.0),
                                         coefs=[0.0] + [a * p_before for a in coefs])
        else:
            ifc.profile = Conic(c=curvature, cc=s.get('conic', 0.0))
        if s.get('reflect'):
            ifc.interact_mode = 'reflect'
        else:
            sm.gaps[-1].medium = ConstantIndex(s['indexAfter'], 'm')
        if is_misaligned(s):
            # 'decenter': applied before the surface and NOT returned, which is
            # Telemicroscope's local coordinate chain. The angles are solved
            # for the matrix the engine's tiltX/tiltY mean — see the module
            # docstring — and the solution is checked before it is used.
            #
            # 'bend' instead for a tilted fold mirror with a chain to steer:
            # rayoptics' own fold concept, applying the rotation after the
            # surface as well. It is checked against the reflected frame first,
            # because the two rules only coincide for a tilt about an in-plane
            # axis and using it where they do not would place the rest of the
            # system somewhere the light does not go.
            rot = engine_rotation(s)
            if p_before < 0:
                # read in a chain whose z runs backwards, the same tilt is the
                # conjugated matrix — for these axes, both angles negated
                rot = DFLIP @ rot @ DFLIP
            dtype = 'decenter'
            if is_folded(system) and s.get('reflect') and is_tilted(s) and i < n_surf - 1:
                bend = rot @ rot
                reflected = (rot @ DFLIP @ rot.transpose()) @ DFLIP
                residual = float(np.abs(bend - reflected).max())
                if residual > BEND_COINCIDENCE_MAX:
                    raise SystemExit(
                        f"'bend' is not the reflected frame on {system['id']} surface {i}: "
                        f"{residual:.3e} > {BEND_COINCIDENCE_MAX:.0e} — a compound tilt "
                        f"must be the last surface, where no chain follows it")
                BEND_RESIDUALS.append((system['id'], i, residual))
                dtype = 'bend'
            alpha, beta, gamma = rayoptics_euler(rot)
            ifc.decenter = DecenterData(dtype,
                                        x=s.get('decenterX', 0.0),
                                        y=s.get('decenterY', 0.0),
                                        alpha=alpha, beta=beta, gamma=gamma)
            residual = float(np.abs(euler2rot3d(np.array([alpha, beta, gamma])) - rot).max())
            if residual > ROT_ROUNDTRIP_MAX:
                raise SystemExit(
                    f"tilt convention translation is not exact on {system['id']}: "
                    f"{residual:.3e} > {ROT_ROUNDTRIP_MAX:.0e}")
            ROT_RESIDUALS.append((system['id'], residual))

    sm.set_stop(0)
    sm.update_model()
    return opm


def global_frames(opm, system):
    """Each surface's frame in the LAUNCH frame, as rayoptics realized it.

    `sm.lcl_tfrms[i]` is the step from interface i to interface i+1, stored as
    (R_cascade transposed, t) with both read in interface i's own coordinates —
    so composing them forward from the object interface, which is where pt0 and
    dir0 live, gives the frame each surface was actually traced in. rayoptics'
    own `gbl_tfrms` anchors instead on the first real surface and moves the
    object; that is the same geometry in a different origin, and the launch
    frame is the one Telemicroscope's world coordinates are.

    Dumped because it is the reconciliation itself: the ray comparison says the
    two programs agree, and this says they agree about WHERE THE GLASS IS
    rather than by two errors cancelling.

    RAW, deliberately. On a folded system these are not the engine's frames —
    they are the engine's frames times D^(mirrors before i) — and the flip is
    applied on the TypeScript side, from the fixture's own surface list. Doing
    it here would hide the reconciliation in the place nothing checks it.
    """
    sm = opm['seq_model']
    rot = np.identity(3)
    vertex = np.zeros(3)
    frames = []
    for i in range(len(system['surfaces'])):
        r_local, t_local = sm.lcl_tfrms[i]
        vertex = vertex + rot.dot(t_local)
        rot = rot.dot(r_local.transpose())
        frames.append({
            # row-major, mapping surface-local coordinates into the launch frame
            "rotation": [float(v) for v in rot.flatten()],
            "vertex": [float(v) for v in vertex],
        })
    return frames


def trace_one(opm, system, frames, ray_spec):
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

    # Points and directions come back in each interface's OWN frame, so both
    # are carried into the launch frame here. On an axial system every rotation
    # is the identity and this reduces to adding the accumulated thickness,
    # which is what it used to do and why those systems' numbers do not move.
    def frame_of(i):
        # ray[0] is on the object interface, whose frame IS the launch frame;
        # ray[i > 0] is on surface i-1.
        return frames[i - 1] if i > 0 else None

    def to_global(pt, i):
        frame = frame_of(i)
        if frame is None:
            return [float(pt[0]), float(pt[1]), float(pt[2])]
        r, v = frame["rotation"], frame["vertex"]
        return [float(r[3 * k] * pt[0] + r[3 * k + 1] * pt[1] + r[3 * k + 2] * pt[2] + v[k])
                for k in range(3)]

    def dir_to_global(d, i):
        frame = frame_of(i)
        if frame is None:
            return [float(v) for v in d]
        r = frame["rotation"]
        return [float(r[3 * k] * d[0] + r[3 * k + 1] * d[1] + r[3 * k + 2] * d[2])
                for k in range(3)]

    hits = [to_global(ray[i][0], i) for i in range(len(ray))]
    # ray[i][1] is the direction LEAVING interface i, so the tail of this list
    # is the direction after each real surface. The last entry is `dir` again;
    # the earlier ones are what no other quantity here can see — a direction
    # error that two surfaces cancel between them, and, on a folded system, the
    # direction the beam actually left a mirror in.
    seg_dirs = [dir_to_global(ray[i][1], i) for i in range(1, len(ray))]

    return {
        "point": hits[-1],
        "dir": dir_to_global(ray[-1][1], len(ray) - 1),
        "opl": float(opl),
        "hits": hits,
        "segDirs": seg_dirs,
    }


def aim_chief(opm, system, frames):
    """Solve for the ray that lands on a stated surface's own vertex.

    Two variables (the launch point's x and y on a plane before the system),
    two conditions (the transverse coordinates where the traced ray meets the
    target surface, read in THAT surface's own frame, both zero). Newton with a
    numerical Jacobian; the map is smooth and nearly affine, so it converges in
    a few steps and the residual lands at the tracing floor.

    Deliberately written here rather than called from rayoptics' own aiming:
    the point of this block is two independent solvers agreeing, and reusing
    one program's solver on both sides would test one solver twice.
    """
    spec = system['aim']
    k = spec['stopSurface']
    z0 = spec['launchZ']
    phi = math.radians(spec['fieldDeg'])
    direction = np.array([math.sin(phi), 0.0, math.cos(phi)])
    sm = opm['seq_model']
    n_surf = len(system['surfaces'])

    def local_hit(qx, qy):
        pt0 = np.array([qx, qy, z0])
        ray, _op, _wvl = raytrace.trace_raw(
            iter(sm.path(wl=WVL)), pt0, direction, WVL,
            check_apertures=False, intersect_obj=False, last_surf=n_surf)
        # ray[i] sits on interface i, in interface i's own coordinates, and our
        # surface k is interface k+1 — so this is already the target frame.
        p = ray[k + 1][0]
        return np.array([float(p[0]), float(p[1])])

    q = np.array([0.0, 0.0])
    h = 1e-4
    for _ in range(40):
        f = local_hit(q[0], q[1])
        if np.abs(f).max() < 1e-13:
            break
        j = np.column_stack([
            (local_hit(q[0] + h, q[1]) - local_hit(q[0] - h, q[1])) / (2 * h),
            (local_hit(q[0], q[1] + h) - local_hit(q[0], q[1] - h)) / (2 * h),
        ])
        q = q - np.linalg.solve(j, f)
    else:
        raise SystemExit(f"aim did not converge on {system['id']}")

    residual = float(np.abs(local_hit(q[0], q[1])).max())
    traced = trace_one(opm, system, frames,
                       {"origin": [q[0], q[1], z0], "dir": list(direction)})
    return {
        **spec,
        "origin": [float(q[0]), float(q[1]), z0],
        "dir": [float(v) for v in direction],
        "residualMm": residual,
        "hits": traced["hits"],
        "exitDir": traced["dir"],
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
        frames = global_frames(opm, system)
        expected = [trace_one(opm, system, frames, r) for r in system['rays']]
        entry = dict(system)
        entry['frames'] = frames
        entry['expected'] = expected
        if 'aim' in system:
            entry['aim'] = aim_chief(opm, system, frames)
        if 'foldCheck' in system:
            entry['foldCheck'] = fold_check(opm, system, frames, expected)
        out['systems'].append(entry)

    path = sys.argv[1] if len(sys.argv) > 1 else "fixture.json"
    with open(path, "w", encoding="utf8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", path)
    for s in out['systems']:
        print(s['id'], len(s['rays']), "rays; last hit",
              [round(v, 9) for v in s['expected'][-1]['point']])
    if ROT_RESIDUALS:
        worst = max(ROT_RESIDUALS, key=lambda r: r[1])
        print(f"tilt convention translation, worst residual: {worst[1]:.3e} "
              f"on {worst[0]} (bound {ROT_ROUNDTRIP_MAX:.0e})")
    if BEND_RESIDUALS:
        worst = max(BEND_RESIDUALS, key=lambda r: r[2])
        print(f"'bend' against the reflected frame, worst residual: {worst[2]:.3e} "
              f"on {worst[0]} surface {worst[1]} (bound {BEND_COINCIDENCE_MAX:.0e})")
    for s in out['systems']:
        if 'foldCheck' in s:
            fc = s['foldCheck']
            print(f"{s['id']}: 'bend' would point the chain "
                  f"{fc['bendDeviationDeg']:.6f} deg off the traced beam")


if __name__ == "__main__":
    main()
