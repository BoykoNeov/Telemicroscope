import type { PanelGroup } from "../guide";

/**
 * The start page's three drawings — one per branch.
 *
 * They are schematics of the light path each branch is about, drawn with the
 * same classes `scope.tsx`'s diagram uses (`scope-light`, `scope-glass`,
 * `scope-metal`, `scope-axis`), so they follow the theme and say, before a word
 * is read, which card is the microscope and which the telescope. Nothing here
 * is computed and nothing claims to be: a start page that traced a lens to
 * decorate a link would spend the reader's first second on a picture the page
 * it leads to draws properly.
 */

const AXIS = 50;

function Microscope() {
  return (
    <>
      <line className="scope-axis" x1={6} y1={AXIS} x2={234} y2={AXIS} />
      {/* lamp → condenser → slide → objective → tube lens → sensor */}
      <polygon className="scope-light" points={`26,${AXIS - 4} 58,${AXIS - 22} 58,${AXIS + 22} 26,${AXIS + 4}`} />
      <polygon className="scope-light" points={`58,${AXIS - 22} 92,${AXIS} 58,${AXIS + 22}`} />
      <polygon className="scope-light" points={`92,${AXIS} 108,${AXIS - 12} 108,${AXIS + 12}`} />
      <rect className="scope-light" x={136} y={AXIS - 14} width={34} height={28} />
      <polygon className="scope-light" points={`170,${AXIS - 14} 212,${AXIS} 170,${AXIS + 14}`} />
      <circle className="scope-bulb home-art-bulb" cx={18} cy={AXIS} r={9} />
      <path className="scope-glass" d={`M58,${AXIS - 26} Q68,${AXIS} 58,${AXIS + 26} Q48,${AXIS} 58,${AXIS - 26} Z`} />
      <rect className="scope-glass" x={89} y={AXIS - 34} width={4} height={68} />
      <circle className="home-art-specimen" cx={92} cy={AXIS} r={2.6} />
      <polygon
        className="scope-metal"
        points={`108,${AXIS - 12} 108,${AXIS + 12} 120,${AXIS + 22} 136,${AXIS + 22} 136,${AXIS - 22} 120,${AXIS - 22}`}
      />
      <path className="scope-glass" d={`M170,${AXIS - 20} Q177,${AXIS} 170,${AXIS + 20} Q163,${AXIS} 170,${AXIS - 20} Z`} />
      <rect className="scope-metal" x={212} y={AXIS - 16} width={18} height={32} rx={3} />
      <rect className="scope-sensor" x={212} y={AXIS - 10} width={2.5} height={20} />
    </>
  );
}

function Telescope() {
  const rays = [-24, -12, 0, 12, 24];
  return (
    <>
      <line className="scope-axis" x1={6} y1={AXIS} x2={234} y2={AXIS} />
      {/* starlight arrives parallel, the lens brings it to a focus */}
      <rect className="scope-light" x={8} y={AXIS - 26} width={60} height={52} />
      <polygon className="scope-light" points={`68,${AXIS - 26} 178,${AXIS} 68,${AXIS + 26}`} />
      {rays.map((y) => (
        <line key={y} className="home-art-ray" x1={8} y1={AXIS + y} x2={68} y2={AXIS + y} />
      ))}
      {rays.map((y) => (
        <line key={y} className="home-art-ray" x1={68} y1={AXIS + y} x2={178} y2={AXIS} />
      ))}
      <path className="scope-glass" d={`M66,${AXIS - 30} Q78,${AXIS} 66,${AXIS + 30} Q58,${AXIS} 66,${AXIS - 30} Z`} />
      <path className="scope-glass" d={`M68,${AXIS - 30} Q80,${AXIS} 68,${AXIS + 30} L74,${AXIS + 30} L74,${AXIS - 30} Z`} />
      {/* what the focus looks like close up: a disc and its rings, not a point */}
      <circle className="home-art-ring" cx={206} cy={AXIS} r={22} style={{ opacity: 0.25 }} />
      <circle className="home-art-ring" cx={206} cy={AXIS} r={15} style={{ opacity: 0.5 }} />
      <circle className="home-art-ring" cx={206} cy={AXIS} r={8.5} style={{ opacity: 0.85 }} />
      <circle className="home-art-core" cx={206} cy={AXIS} r={4.5} />
      <line className="scope-dashed" x1={178} y1={AXIS} x2={184} y2={AXIS} />
    </>
  );
}

function Design() {
  return (
    <>
      <line className="scope-axis" x1={6} y1={AXIS} x2={234} y2={AXIS} />
      {/* a cemented doublet in section, with the numbers a shop is asked to hold */}
      <path
        className="scope-glass"
        d={`M84,${AXIS - 34} Q104,${AXIS} 84,${AXIS + 34} L104,${AXIS + 34} Q88,${AXIS} 104,${AXIS - 34} Z`}
      />
      <path
        className="scope-glass home-art-flint"
        d={`M104,${AXIS - 34} Q88,${AXIS} 104,${AXIS + 34} L124,${AXIS + 34} Q128,${AXIS} 124,${AXIS - 34} Z`}
      />
      {/* thickness */}
      <line className="home-art-dim" x1={94} y1={AXIS + 42} x2={126} y2={AXIS + 42} />
      <line className="home-art-dim" x1={94} y1={AXIS + 38} x2={94} y2={AXIS + 46} />
      <line className="home-art-dim" x1={126} y1={AXIS + 38} x2={126} y2={AXIS + 46} />
      {/* diameter */}
      <line className="home-art-dim" x1={70} y1={AXIS - 34} x2={70} y2={AXIS + 34} />
      <line className="home-art-dim" x1={66} y1={AXIS - 34} x2={74} y2={AXIS - 34} />
      <line className="home-art-dim" x1={66} y1={AXIS + 34} x2={74} y2={AXIS + 34} />
      {/* a merit curve falling to its floor: the solver at work */}
      <polyline className="home-art-curve" points="150,22 160,44 170,56 180,63 192,67 206,69 226,70" />
      <line className="scope-dashed" x1={150} y1={72} x2={228} y2={72} />
      <text className="home-art-text" x={110} y={AXIS + 4} textAnchor="middle">
        ±
      </text>
    </>
  );
}

export function BranchArt({ group }: { group: PanelGroup }) {
  return (
    <svg className="home-art" viewBox="0 0 240 100" aria-hidden="true">
      {group === "telescope" ? <Telescope /> : group === "design" ? <Design /> : <Microscope />}
    </svg>
  );
}
