/**
 * Turning a mail body into the text an instruction reader can work with.
 *
 * Graph returns most business mail as HTML, and a corporate signature block is
 * a nested table with a logo and a legal disclaimer — several times the size of
 * the one sentence that says which custom house to file at. Sanitising happens
 * here, at ingest, so what lands in `mail_messages.body_text` is already the
 * readable form and nothing downstream has to know the mail was ever HTML.
 */
export function mailBodyToText(body: string): string {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    // Block ends become line breaks before tags are stripped, or every
    // paragraph runs into the next and quoted replies become one line.
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
