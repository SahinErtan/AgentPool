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

/** What the symbols in the agent list mean. */
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
      </details>
    </section>
  );
}
