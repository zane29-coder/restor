/**
 * String helpers — slugs, order numbers, masking and safe truncation.
 */

/** Cyrillic → Latin, so a Russian/Uzbek-Cyrillic name still yields a usable slug. */
const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

/**
 * URL-safe slug: `"Chilonzor filiali"` → `"chilonzor-filiali"`.
 * Uniqueness is the caller's job — see {@link uniqueSlug}.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .split('')
    .map((char) => CYRILLIC_MAP[char] ?? char)
    .join('')
    .normalize('NFD')
    // Strip combining accents left by NFD.
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Appends a numeric suffix until the slug is free.
 * `existing` is the set of slugs already taken in the same scope.
 */
export function uniqueSlug(base: string, existing: ReadonlySet<string>): string {
  const slug = slugify(base) || 'item';
  if (!existing.has(slug)) return slug;
  let suffix = 2;
  while (existing.has(`${slug}-${suffix}`)) suffix += 1;
  return `${slug}-${suffix}`;
}

/**
 * Builds the human-readable order label (TZ §41).
 *
 * With a branch prefix: `CH-1054`. Without one: `#1054`.
 */
export function formatOrderNumber(number: number, branchPrefix?: string | null): string {
  return branchPrefix ? `${branchPrefix}-${number}` : `#${number}`;
}

/**
 * Derives a short branch prefix from its name, e.g. `"Chilonzor"` → `"CH"`.
 * Falls back to the first two alphanumeric characters, upper-cased.
 */
export function deriveBranchPrefix(branchName: string, length = 2): string {
  const latin = slugify(branchName).replace(/-/g, '');
  return (latin.slice(0, length) || 'BR').toUpperCase();
}

/** Truncates with an ellipsis, never cutting mid-surrogate. */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${Array.from(input).slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

/**
 * Escapes text for Telegram's MarkdownV2 parse mode.
 *
 * Order comments and customer names are attacker-controlled: an unescaped `_`
 * in a name breaks the whole notification message.
 */
export function escapeMarkdownV2(input: string): string {
  return input.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (char) => `\\${char}`);
}

/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Case-insensitive, whitespace-tolerant comparison for promo codes etc. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/** Initials for an avatar placeholder: `"Elbek Azizov"` → `"EA"`. */
export function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
