/**
 * Omnibox-style normalization for quick-open / navigate: `http(s)` unchanged;
 * plausible bare hostnames → `https://…`; everything else → Google search.
 *
 * Without this, JS-looking input like `Object.keys` or `foo.bar()` becomes
 * `https://Object.keys` and fails to load, so quick-feed appears to do nothing.
 */

const COMMON_TLDS = new Set([
  'com',
  'org',
  'net',
  'edu',
  'gov',
  'mil',
  'int',
  'io',
  'co',
  'app',
  'dev',
  'ai',
  'tv',
  'me',
  'us',
  'uk',
  'de',
  'fr',
  'jp',
  'cn',
  'ru',
  'ca',
  'au',
  'in',
  'br',
  'eu',
  'nz',
  'nl',
  'se',
  'no',
  'cz',
  'pl',
  'kr',
  'es',
  'it',
  'ch',
  'be',
  'at',
  'dk',
  'fi',
  'ie',
  'il',
  'hk',
  'sg',
  'tw',
  'mx',
  'za',
  'pt',
  'gr',
  'ro',
  'hu',
  'vn',
  'tr',
  'id',
  'th',
  'ph',
  'my',
  'ae',
  'sa',
  'club',
  'online',
  'site',
  'tech',
  'info',
  'biz',
  'xyz',
  'cc',
  'ws',
  'mobi',
  'name',
  'pro',
  'travel',
])

/** Public suffix style: last two labels are a known pair (e.g. co.uk). */
const TWO_LEVEL_PUBLIC = new Set([
  'co.uk',
  'com.au',
  'co.jp',
  'co.nz',
  'com.br',
  'com.ar',
  'co.za',
  'com.mx',
  'ne.jp',
  'or.jp',
  'ac.uk',
  'gov.uk',
])

function hostnameLooksNavigable(host: string): boolean {
  const raw = host.trim().toLowerCase().split('/')[0].split('?')[0].split('#')[0]
  if (!raw) return false
  const h = raw.split(':')[0]
  if (h === 'localhost') return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true

  const labels = h.split('.').filter(Boolean)
  if (labels.length < 2) return false

  const last2 = labels.slice(-2).join('.')
  if (TWO_LEVEL_PUBLIC.has(last2)) return true

  const tld = labels[labels.length - 1]!
  return COMMON_TLDS.has(tld)
}

/**
 * @param trimmed non-empty trimmed user input
 * @returns full `https://…` URL (search or site)
 */
export function normalizeQuickOpenInput(trimmed: string): string {
  if (!trimmed) return ''

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  const noSpace = !/\s/.test(trimmed)
  const hasDot = trimmed.includes('.')

  if (noSpace && hasDot) {
    const hostPart = trimmed.split('/')[0].split('?')[0].split('#')[0]
    if (hostPart && hostnameLooksNavigable(hostPart)) {
      return `https://${trimmed}`
    }
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}
