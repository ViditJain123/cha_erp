/**
 * Company slug: lowercase, alphanumeric, single hyphens, 1-62 chars. Must match
 * the CHECK constraint on `companies.slug` in the tenancy migration.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 62)
    .replace(/-+$/g, '');
  return slug;
}
