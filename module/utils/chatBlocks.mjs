/**
 * Small shared helpers for assembling chat-card blocks.
 */

/**
 * Whether a description string carries anything worth showing. Item descriptions
 * come out of the editor as HTML, so an "empty" one is often still `<p></p>` or
 * a stray `&nbsp;` — those must not render a Description table with a blank row.
 * Images and tables count as content even though they strip to no text.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function hasHtmlContent(html) {
  if (!html) return false;
  const raw = String(html);
  if (/<(img|table)\b/i.test(raw)) return true;
  return (
    raw
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;/gi, " ")
      .trim().length > 0
  );
}
