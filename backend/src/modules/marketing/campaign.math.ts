/**
 * The marketing send limit (TZ 48 §16.2), pure so it can be pinned by tests.
 *
 * One message per restaurant per day. Customers opted in to hear about a
 * restaurant, not to be messaged by it every hour; a bot that spams gets
 * blocked, and a blocked bot cannot deliver the order updates that matter.
 */
export const CAMPAIGN_COOLDOWN_HOURS = 24;

/** When the next send is allowed, or `null` if it is allowed now. */
export function nextCampaignAllowedAt(
  lastSentAt: Date | null,
  now: Date,
  cooldownHours = CAMPAIGN_COOLDOWN_HOURS,
): Date | null {
  if (!lastSentAt) return null;
  const next = new Date(lastSentAt.getTime() + cooldownHours * 60 * 60 * 1000);
  return next.getTime() > now.getTime() ? next : null;
}
