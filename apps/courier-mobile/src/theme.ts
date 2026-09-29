import { StyleSheet } from 'react-native';

/**
 * Shared look for the courier app.
 *
 * The sizing rule behind most of these numbers: a courier taps this
 * one-handed, outdoors, often in the cold and often in a hurry. Nothing
 * interactive is under 56px, and nothing important is under 15pt.
 */
export const colors = {
  brand: '#FF6B00',
  ink: '#111827',
  inkSoft: '#6B7280',
  line: '#E5E7EB',
  bg: '#F3F4F6',
  surface: '#FFFFFF',
  dark: '#1F2937',
  darkSoft: '#374151',
  darkText: '#94A3B8',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  red: '#DC2626',
  redSoft: '#FEE2E2',
  amberSoft: '#FEF3C7',
  blue: '#2563EB',
} as const;

/** `156000` → `156 000 soʻm`. The narrow space matches local receipts. */
export function money(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${digits} soʻm`;
}

/** `HH:mm`, and `DD.MM HH:mm` once the timestamp is not from today. */
export function timeLabel(iso: string): string {
  const at = new Date(iso);
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');

  const now = new Date();
  const sameDay =
    at.getDate() === now.getDate() &&
    at.getMonth() === now.getMonth() &&
    at.getFullYear() === now.getFullYear();
  if (sameDay) return `${hh}:${mm}`;

  const dd = String(at.getDate()).padStart(2, '0');
  const mo = String(at.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mo} ${hh}:${mm}`;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: 14, paddingBottom: 40 },

  /* ------------------------------ Chrome ---------------------------- */

  header: {
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 18,
    backgroundColor: colors.dark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  brandAccent: { color: colors.brand },
  headerSub: { color: colors.darkText, fontSize: 13, marginTop: 2 },

  statusChip: {
    paddingHorizontal: 16,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  statusChipOn: { backgroundColor: colors.green },
  statusText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: colors.brand },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.inkSoft, letterSpacing: 0.4 },
  tabTextActive: { color: colors.ink },
  tabBadge: {
    position: 'absolute',
    top: 10,
    right: '22%',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  errorBar: { backgroundColor: colors.redSoft, paddingVertical: 10, paddingHorizontal: 18 },
  errorText: { color: '#991B1B', fontSize: 13 },

  /* ------------------------------ Blocks ---------------------------- */

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: colors.inkSoft },
  value: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 2 },
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 70 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  emptyHint: { fontSize: 14, color: colors.inkSoft, textAlign: 'center', paddingHorizontal: 30 },

  /* ----------------------------- Controls --------------------------- */

  // No `flex` here on purpose. A flexed child inside a centred column stretches
  // to fill the whole screen -- which is exactly what made the login button
  // absurdly tall. Rows that want equal widths add `btnFlex` themselves.
  btn: { minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnFlex: { flex: 1 },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  btnGhostText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.55 },

  input: {
    backgroundColor: colors.surface,
    color: colors.ink,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    minHeight: 54,
    fontSize: 16,
  },
});
