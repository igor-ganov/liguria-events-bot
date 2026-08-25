/**
 * The opening paragraph of a description, without the article around it.
 *
 * Descriptions are a structured Markdown article for the website: a lead, then
 * "## [tag] Label" sections and "- " bullets. Telegram renders none of that, so
 * the first channel post carried the literal text "## [programme] Programma"
 * into a public feed. The lead is the 2-4 sentence summary the prompt asks for
 * first, and it is the whole of what a post needs.
 */
export const leadOf = (description: string): string =>
  (description.split(/(?:^|\n)\s*(?:##|- )/)[0] ?? '').replace(/\s+/g, ' ').trim();
