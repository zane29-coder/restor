/**
 * The till lives on its own host (`pos.restor.uz` next to `app.restor.uz`),
 * so "new order" opens it rather than duplicating a cart here. `VITE_POS_URL`
 * overrides the guess, e.g. for local development.
 */
export function posUrl(): string | null {
  const configured = import.meta.env.VITE_POS_URL as string | undefined;
  if (configured) return configured;
  const { protocol, host } = window.location;
  if (host.startsWith('app.')) return `${protocol}//pos.${host.slice(4)}`;
  if (host.startsWith('localhost')) return `${protocol}//localhost:5175`;
  return null;
}
