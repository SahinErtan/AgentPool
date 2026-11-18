/**
 * The model an agent runs on, and the tokens it costs, in words a person
 * reads.
 *
 * The backend names the model the way Claude Code does: "claude-opus-5-5",
 * "MiniMax-M3.1-Flash", "qwen3.5:2b". The names are not ours and they
 * change with every release, so nothing here may break on a name it has
 * never seen: an unknown name is left as it is.
 *
 * The module is pure: no state, no exceptions, no randomness.
 */

/** The families of Claude the backend may name. */
const CLAUDE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?$/;

/** A word that keeps its own case: "MiniMax" is not "Minimax". */
function prettifyWord(word: string): string {
  if (!word) return word;
  if (word !== word.toLowerCase()) return word;
  let out = word.charAt(0).toUpperCase() + word.slice(1);
  // A size at the end of a word is a size: "2b" is "2B", not "2b".
  out = out.replace(/([0-9])([bm])$/, (_match, digits: string, unit: string) => digits + unit.toUpperCase());
  return out;
}

/**
 * The model of an agent, in words.
 *
 * "claude-opus-5-5" becomes "Opus 5.5", "MiniMax-M3.1-Flash" becomes
 * "MiniMax M3.1 Flash" and "qwen3.5:2b" becomes "Qwen 3.5 2B". A name
 * that is not known comes back unchanged.
 */
export function prettyModel(model: string | null | undefined): string {
  if (!model) return '';
  const trimmed = model.trim();
  if (!trimmed) return '';

  const claude = CLAUDE.exec(trimmed);
  if (claude) {
    const family = claude[1].charAt(0).toUpperCase() + claude[1].slice(1);
    const major = claude[2];
    const minor = claude[3];
    return minor ? `${family} ${major}.${minor}` : `${family} ${major}`;
  }

  return trimmed
    .split(/[-_:]+/)
    .filter((word) => word.length > 0)
    .map((word) => {
      // A name and a number that are stuck together are two words:
      // "qwen3.5" is "Qwen 3.5".
      const spaced = word.replace(/([a-z])(\d)/g, '$1 $2');
      return spaced
        .split(' ')
        .map(prettifyWord)
        .join(' ');
    })
    .join(' ');
}

/**
 * A number of tokens, in a way a person reads it.
 *
 * A thousand is a thousand, and a million is a million: the exact number
 * is in the title of the row, and the row itself says "1.2 M".
 */
export function prettyTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return '';
  const value = Math.round(tokens);
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1_000_000) {
    const thousands = value / 1000;
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)} k`;
  }
  const millions = value / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1) : Math.round(millions)} M`;
}

/**
 * The tokens of the last turn, in one phrase: what went in and what came
 * out. Empty when the agent has no turn yet.
 */
export function prettyTurn(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  const into = prettyTokens(tokensIn);
  const out = prettyTokens(tokensOut);
  if (!into && !out) return '';
  if (!into) return `${out} out`;
  if (!out) return `${into} in`;
  return `${into} in · ${out} out`;
}
