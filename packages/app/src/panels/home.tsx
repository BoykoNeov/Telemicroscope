import { TOPICS, TOURS, type Topic } from "../guide";
import { PANELS, PANEL_GROUPS, type Panel } from "./registry";

/**
 * The start page — APP.md's Part R.
 *
 * Built entirely from the registry and `guide.ts`: no surface is named here by
 * hand, so a panel added to the registry appears on this page by construction,
 * in the section its `topic` says. `guide.test.ts` holds the other direction —
 * that every topic and every tour step resolves to something real.
 *
 * Two ways in, in this order. The **guided paths** come first because they
 * answer the question a first visit actually has, "where do I begin", with an
 * order rather than a list. The **map** below them is every surface, grouped as
 * the header's menus are, each with one plain sentence; it is the page a
 * returning reader scans.
 */

/** Fetch a route's chunk ahead of the click, as the header's links do. */
function warm(entry: Panel): void {
  entry.load().catch(() => {});
}

const byId = (id: string): Panel | undefined => PANELS.find((p) => p.id === id);

function SurfaceCard({ entry }: { entry: Panel }) {
  return (
    <a
      className="home-card"
      href={`#/${entry.id}`}
      onMouseEnter={() => warm(entry)}
      onFocus={() => warm(entry)}
    >
      <span className="home-card-title">{entry.label}</span>
      <span className="home-card-summary">{entry.summary}</span>
    </a>
  );
}

function TopicSection({ topic }: { topic: Topic }) {
  const entries = PANELS.filter((p) => p.topic === topic.id);
  if (entries.length === 0) return null;
  return (
    <section className="home-topic">
      <h3>{topic.label}</h3>
      <p className="home-topic-hint">{topic.hint}</p>
      <div className="home-cards">
        {entries.map((entry) => (
          <SurfaceCard key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

export function HomePanel() {
  return (
    <div className="home">
      <h1 className="home-title">A telescope and microscope bench, computed from the light itself</h1>
      <p className="home-lead">
        Every picture here is calculated by tracing real rays and waves through real lens designs —
        nothing is painted on. Blur, colour fringes and the limits of what you can see come out of
        the physics. If a design cannot work, the page says so in the engine&rsquo;s own words
        instead of drawing something plausible.
      </p>

      <a
        className="home-hero"
        href="#/scope"
        onMouseEnter={() => {
          const scope = byId("scope");
          if (scope) warm(scope);
        }}
      >
        <span className="home-hero-kicker">start here</span>
        <span className="home-hero-title">The whole microscope →</span>
        <span className="home-hero-text">
          A drawing of a microscope from lamp to camera. Click any part — the condenser, the slide, the
          cover slip, the objective, the tube lens, the camera or your eye — change it, and see what
          happens to the picture, side by side with how it looked before.
        </span>
      </a>

      <h2 className="home-section">Guided paths</h2>
      <p className="home-section-hint">
        Not sure where to begin? Each path visits a handful of pages in order; every page on a path
        has a &ldquo;next&rdquo; link at the top.
      </p>
      <div className="home-tours">
        {TOURS.map((tour) => {
          const first = byId(tour.steps[0]!);
          return (
            <section className="home-tour" key={tour.id}>
              <h3>{tour.title}</h3>
              <p className="home-topic-hint">{tour.why}</p>
              <ol className="home-tour-steps">
                {tour.steps.map((id) => {
                  const entry = byId(id);
                  if (!entry) return null;
                  return (
                    <li key={id}>
                      <a href={`#/${id}`} onMouseEnter={() => warm(entry)} onFocus={() => warm(entry)}>
                        {entry.label}
                      </a>
                    </li>
                  );
                })}
              </ol>
              {first ? (
                <a className="home-tour-start" href={`#/${first.id}`}>
                  start this path →
                </a>
              ) : null}
            </section>
          );
        })}
      </div>

      <h2 className="home-section">Everything, by subject</h2>
      <p className="home-section-hint">
        The same list the menus at the top hold, with a sentence on each.
      </p>
      {PANEL_GROUPS.filter((group) => group.id !== "start").map((group) => (
        <section className="home-group" key={group.id}>
          <h2 className="home-group-title">{group.label}</h2>
          {TOPICS.filter((topic) => topic.group === group.id).map((topic) => (
            <TopicSection key={topic.id} topic={topic} />
          ))}
        </section>
      ))}
    </div>
  );
}
