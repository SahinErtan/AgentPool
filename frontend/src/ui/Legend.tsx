const KIND_MARKS: { mark: string; label: string }[] = [
  { mark: '◆', label: 'Session' },
  { mark: '●', label: 'Subagent' },
  { mark: '■', label: 'MCP server' },
  { mark: '▲', label: 'Workflow' },
];

const SCENE_LEGEND: { mark: string; label: string }[] = [
  { mark: '🏊', label: 'Swimming — the agent is working' },
  { mark: '🛟', label: 'On a lounger — the agent is idle' },
  { mark: '🧍', label: 'Waiting at the edge — the pool is full' },
  { mark: '🚪', label: 'At the gate — on the way in or out' },
];

const SWIM_STYLES: { label: string; hint: string }[] = [
  { label: 'Crawl', hint: 'over the side, alternating arms' },
  { label: 'Breaststroke', hint: 'the head comes up to breathe' },
  { label: 'Butterfly', hint: 'both arms at once, the body waves' },
  { label: 'Doggy paddle', hint: 'the head stays above the water' },
];

const ACCESSORIES: { label: string; hint: string }[] = [
  { label: 'Sun hat', hint: 'shades the eyes' },
  { label: 'Cap', hint: 'with a peak' },
  { label: 'Goggles', hint: 'on the forehead' },
  { label: 'Floatie', hint: 'the ring around the waist' },
  { label: 'Snorkel', hint: 'a tube and a mouthpiece' },
  { label: 'Nothing', hint: 'just a character' },
];

const ACTIVITIES: { label: string; hint: string }[] = [
  { label: 'Tea', hint: 'the steam gives it away' },
  { label: 'Book', hint: 'pages turning' },
  { label: 'Phone', hint: 'scrolling' },
  { label: 'Sunbathe', hint: 'sunglasses on' },
  { label: 'Nap', hint: 'the Z glyphs' },
  { label: 'Stretch', hint: 'arms up' },
  { label: 'Snack', hint: 'something to eat' },
  { label: 'Chat', hint: 'a bubble above the head' },
];

/** What the symbols in the agent list mean, and what the characters wear. */
export function Legend() {
  return (
    <section className="legend">
      <details>
        <summary>Legend</summary>

        <div className="legend__group">
          <h3>Agents</h3>
          <ul>
            {KIND_MARKS.map((item) => (
              <li key={item.label}>
                <span className="legend__mark">{item.mark}</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="legend__group">
          <h3>In the pool</h3>
          <ul>
            {SCENE_LEGEND.map((item) => (
              <li key={item.label}>
                <span className="legend__mark">{item.mark}</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="legend__group">
          <h3>Swim styles</h3>
          <ul>
            {SWIM_STYLES.map((item) => (
              <li key={item.label}>
                <span className="legend__mark">〰</span>
                <strong>{item.label}</strong>
                <span className="legend__hint"> — {item.hint}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="legend__group">
          <h3>Accessories</h3>
          <ul>
            {ACCESSORIES.map((item) => (
              <li key={item.label}>
                <span className="legend__mark">•</span>
                <strong>{item.label}</strong>
                <span className="legend__hint"> — {item.hint}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="legend__group">
          <h3>On the lounger</h3>
          <ul>
            {ACTIVITIES.map((item) => (
              <li key={item.label}>
                <span className="legend__mark">☕</span>
                <strong>{item.label}</strong>
                <span className="legend__hint"> — {item.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}
