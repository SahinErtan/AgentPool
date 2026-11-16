/**
 * Plain text for the panels and the card over the pool.
 *
 * Pure, and kept out of the React components so that the scene can use it
 * without importing the panels.
 */

/**
 * The prompt of an agent is written in markdown, and the panels show it
 * as plain text: the stars and the backticks are noise here.
 */
export function plainText(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cut a text at a word boundary.
 *
 * A cut in the middle of a word is unreadable, so the last word that does
 * not fit is dropped and an ellipsis says that something is missing. A
 * single word that is longer than the limit stays whole: there is no
 * word boundary inside it to cut at.
 */
export function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const words = text.split(' ').filter(Boolean);
  let out = '';
  for (const word of words) {
    if (out === '') {
      if (word.length > limit) return word;
      out = word;
      continue;
    }
    if (out.length + 1 + word.length > limit) break;
    out += ` ${word}`;
  }
  return `${out}…`;
}
