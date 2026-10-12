import type { SVGProps } from 'react';

/**
 * Icon set.
 *
 * Hand-drawn inline SVG rather than emoji or an icon font, for three reasons:
 *
 *  1. **Emoji are not a design system.** They render differently on every OS —
 *     Apple's 🍔 and Windows' 🍔 share nothing but a name — and at small sizes
 *     they read as decoration rather than as interface.
 *  2. **They inherit `currentColor`**, so an icon matches its label in the
 *     sidebar, on a dark KDS and inside Telegram's theme without a second
 *     palette.
 *  3. **No dependency.** An icon library would add a package and a build step
 *     for the fifteen glyphs this platform actually uses.
 *
 * Geometry follows the common 24×24 stroke convention (1.75px stroke, round
 * caps and joins), which is what makes a mixed set look like one family.
 *
 * Every icon is decorative by default: `aria-hidden` is set, and the meaning
 * is carried by the adjacent text. Pass `title` when an icon stands alone.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Rendered square, in px. */
  size?: number;
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons sitting next to a label. */
  title?: string;
}

function Icon({
  size = 20,
  strokeWidth = 1.75,
  title,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Keeps the icon aligned with text rather than sitting on the baseline.
      style={{ display: 'block', flexShrink: 0, ...rest.style }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

export const IconDashboard = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
);

export const IconOrders = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 3.5 6.5 5 8 3.5 9.5 5 11 3.5 12.5 5 14 3.5 15.5 5 17 3.5v16L15.5 18 14 19.5 12.5 18 11 19.5 9.5 18 8 19.5 6.5 18 5 19.5z" />
    <path d="M8.5 8.5h5M8.5 12h5" />
  </Icon>
);

export const IconMenu = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 11h18" />
    <path d="M5 11a7 7 0 0 1 14 0" />
    <path d="M4 15h16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    <path d="M9 7.5h.01M12 6.5h.01M15 7.5h.01" />
  </Icon>
);

export const IconBranch = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 9.5 4.5 4h15L21 9.5" />
    <path d="M3 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0" />
    <path d="M4.5 11.5V20h15v-8.5" />
    <path d="M9.5 20v-5h5v5" />
  </Icon>
);

export const IconUsers = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.6a3.25 3.25 0 0 1 0 6.3" />
    <path d="M17.5 14.4A5.5 5.5 0 0 1 20.5 20" />
  </Icon>
);

export const IconKitchen = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 20V9.8A4.8 4.8 0 0 1 12 5a4.8 4.8 0 0 1 6 4.8V20" />
    <path d="M6 16h12" />
    <path d="M9.5 5.2a2.6 2.6 0 0 1 5 0" />
  </Icon>
);

export const IconPos = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="11" rx="2" />
    <path d="M3 18.5h18" />
    <path d="M7 8h4M7 11h2" />
    <path d="M15.5 8h1.5" />
  </Icon>
);

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export const IconCheck = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
);

export const IconCheckCircle = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.5 2.5L16 9.5" />
  </Icon>
);

export const IconAlert = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Icon>
);

export const IconInfo = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4.5M12 8h.01" />
  </Icon>
);

/** Filled dot for a connection indicator — colour carries the state. */
export const IconDot = ({ size = 10, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 10 10"
    fill="currentColor"
    style={{ display: 'block', flexShrink: 0, ...rest.style }}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <circle cx="5" cy="5" r="4" />
  </svg>
);

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

export const IconPlus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconMinus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14" />
  </Icon>
);

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const IconNote = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    <path d="M14.5 5.5l3 3" />
  </Icon>
);

export const IconPhone = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
  </Icon>
);

export const IconMapPin = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 10.5c0 5-7 10.5-7 10.5S5 15.5 5 10.5a7 7 0 1 1 14 0Z" />
    <circle cx="12" cy="10.5" r="2.5" />
  </Icon>
);

/** A scooter: the vehicle most RESTOR deliveries actually arrive on. */
export const IconCourier = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5.5" cy="17.5" r="2.5" />
    <circle cx="18" cy="17.5" r="2.5" />
    <path d="M8 17.5h7.5" />
    <path d="M13 6h3l2 11.5" />
    <path d="M5.5 15V11h5l2.5 3" />
    <path d="M4 8h3" />
  </Icon>
);

/** A price tag: promotions and promo codes. */
export const IconTag = (props: IconProps) => (
  <Icon {...props}>
    <path d="M11.5 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.5a2 2 0 0 1-.6 1.4l-6.5 6.5a2 2 0 0 1-2.8 0l-6.5-6.5a2 2 0 0 1 0-2.8l6.5-6.5a2 2 0 0 1 1.4-.6Z" />
    <circle cx="16" cy="8" r="1.5" />
  </Icon>
);

export const IconLogout = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4" />
    <path d="M10 16.5 14.5 12 10 7.5" />
    <path d="M14.5 12H4" />
  </Icon>
);

export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 4.5 4.5" />
  </Icon>
);

export const IconInbox = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    <path d="M5.2 5h13.6a2 2 0 0 1 1.9 1.4L23 13v4a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-4L3.3 6.4A2 2 0 0 1 5.2 5Z" />
  </Icon>
);

/* -------------------------------------------------------------------------- */
/* Storefront (Mini App)                                                      */
/* -------------------------------------------------------------------------- */

export const IconArrowLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Icon>
);

export const IconChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 5.5 6.5 6.5L9 18.5" />
  </Icon>
);

export const IconChevronDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5.5 9 6.5 6.5L18.5 9" />
  </Icon>
);

export const IconHeart = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z" />
  </Icon>
);

/** The same heart, filled — the "favourited" state. */
export const IconHeartFilled = (props: IconProps) => (
  <Icon {...props} fill="currentColor">
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z" />
  </Icon>
);

export const IconUser = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Icon>
);

export const IconBell = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10Z" />
    <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
  </Icon>
);

/** A shopping basket: the cart. */
export const IconBasket = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 9.5h17l-1.6 9a1.8 1.8 0 0 1-1.8 1.5H6.9a1.8 1.8 0 0 1-1.8-1.5Z" />
    <path d="m8 9.5 3-5.5M16 9.5 13 4" />
    <path d="M9.5 13.5v3M14.5 13.5v3" />
  </Icon>
);

/** Fork and knife: cutlery sets. */
export const IconCutlery = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 3.5V10a2 2 0 0 0 2 2v8.5" />
    <path d="M11 3.5V10a2 2 0 0 1-2 2" />
    <path d="M9 3.5V8" />
    <path d="M16.5 20.5V3.5c-2 1.2-3 3.6-3 6.4 0 1.7.9 2.6 3 2.6" />
  </Icon>
);

export const IconMessage = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17.5h-1A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5Z" />
  </Icon>
);

export const IconHelp = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7" />
    <path d="M12 17h.01" />
  </Icon>
);

export const IconClock = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const IconTrash = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12" />
    <path d="M10 11v5.5M14 11v5.5" />
  </Icon>
);

/** "Where am I": centre the map on the device's location. */
export const IconLocate = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </Icon>
);

export const IconHome = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5.5h4V20" />
  </Icon>
);

export const IconBriefcase = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="7.5" width="18" height="12" rx="2" />
    <path d="M9 7.5V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2" />
    <path d="M3 12.5h18" />
  </Icon>
);

export const IconCard = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
    <path d="M2.5 10h19" />
    <path d="M6.5 14.5h3" />
  </Icon>
);

export const IconCash = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M5.5 9.5v.01M18.5 14.5v.01" />
  </Icon>
);

export const IconMore = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" strokeWidth={3} />
  </Icon>
);

/** A door: "leave at the door". */
export const IconDoor = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" />
    <path d="M4 20.5h16" />
    <path d="M14.5 12.5h.01" strokeWidth={2.5} />
  </Icon>
);

/** Telegram's paper plane, for Mini App screens. */
export const IconTelegram = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 4 3 11l6 2.5L21 4Z" />
    <path d="m21 4-9 16-3-6.5L21 4Z" />
  </Icon>
);

/* -------------------------------------------------------------------------- */
/* Admin panel                                                                */
/* -------------------------------------------------------------------------- */

/** Staff badge — the employees section. */
export const IconBadge = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M9.5 5V3.5h5V5" />
    <circle cx="12" cy="11" r="2.25" />
    <path d="M8.5 16.5a3.5 3.5 0 0 1 7 0" />
  </Icon>
);

/** Restaurant table with two chairs. */
export const IconTable = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 9h17" />
    <path d="M6.5 9v10M17.5 9v10" />
    <path d="M3.5 13.5h3M17.5 13.5h3" />
    <path d="M3.5 6v13M20.5 6v13" />
  </Icon>
);

/** Storage box — inventory. */
export const IconBox = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" />
    <path d="M3.5 7.5 12 11.5l8.5-4" />
    <path d="M12 11.5v9" />
  </Icon>
);

/** Line chart — reports. */
export const IconChart = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 4v16h16" />
    <path d="m7.5 14.5 3.5-4 3 2.5 5-6" />
  </Icon>
);

export const IconBarChart = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20h16" />
    <path d="M7 16v-5M12 16V6M17 16v-8" />
  </Icon>
);

export const IconPieChart = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5v8.5h8.5" />
    <path d="M20.5 12A8.5 8.5 0 1 1 12 3.5" />
  </Icon>
);

export const IconSun = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);

export const IconMoon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Icon>
);

/** Up/down chevrons: a control that opens a list of alternatives. */
export const IconSelector = (props: IconProps) => (
  <Icon {...props}>
    <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
  </Icon>
);

export const IconArrowRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </Icon>
);

export const IconArrowUpRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 17 17 7M8.5 7H17v8.5" />
  </Icon>
);

export const IconTrendUp = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3.5 17 6-6 4 4 7-7.5" />
    <path d="M15 7.5h5.5V13" />
  </Icon>
);

export const IconTrendDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3.5 7 6 6 4-4 7 7.5" />
    <path d="M15 16.5h5.5V11" />
  </Icon>
);

export const IconDownload = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v11M7 10.5l5 5 5-5" />
    <path d="M4.5 19.5h15" />
  </Icon>
);

export const IconUpload = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 15.5v-11M7 9l5-5 5 5" />
    <path d="M4.5 19.5h15" />
  </Icon>
);

export const IconWallet = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 7.5V6a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20H19a2 2 0 0 0 2-2v-8.5a2 2 0 0 0-2-2H5.5" />
    <path d="M16.5 14h.01" strokeWidth={2.5} />
  </Icon>
);

export const IconQr = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
    <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
    <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
    <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2" />
  </Icon>
);

export const IconCalendar = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Icon>
);

export const IconPrint = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 8V3.5h10V8" />
    <rect x="3.5" y="8" width="17" height="8.5" rx="2" />
    <path d="M7 13.5h10v7H7z" />
  </Icon>
);

export const IconEye = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const IconEyeOff = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.4 7.4A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" />
  </Icon>
);

export const IconEdit = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const IconCopy = (props: IconProps) => (
  <Icon {...props}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
  </Icon>
);

export const IconPause = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10 9v6M14 9v6" />
  </Icon>
);

export const IconPlay = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m10 8.5 5.5 3.5-5.5 3.5z" />
  </Icon>
);

/** A crossed circle: stop-listed, blocked, not available. */
export const IconBan = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const IconFilter = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5.5h16l-6 7.5v5.5l-4 2v-7.5z" />
  </Icon>
);

export const IconGrid = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const IconList = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={2.5} />
  </Icon>
);

export const IconKanban = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="3.5" width="5" height="17" rx="1.5" />
    <rect x="9.5" y="3.5" width="5" height="11" rx="1.5" />
    <rect x="15.5" y="3.5" width="5" height="14" rx="1.5" />
  </Icon>
);

export const IconMap = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Icon>
);

/** Lightning bolt: something that happens automatically. */
export const IconBolt = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
  </Icon>
);

export const IconKey = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l2.5 2.5M14.5 8.5 17 11" />
  </Icon>
);

export const IconShield = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 4.5 6v5.5c0 4.4 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5.1 7.5-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const IconStar = (props: IconProps) => (
  <Icon {...props}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />
  </Icon>
);

export const IconLink = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

export const IconExternal = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Icon>
);

export const IconRefresh = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" />
    <path d="M18.5 3v4.5H14M5.5 21v-4.5H10" />
  </Icon>
);

export const IconSave = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 3.5h11l3.5 3.5v11.5a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
    <path d="M7.5 3.5V8h7V3.5M7.5 20.5v-6h9v6" />
  </Icon>
);

export const IconImage = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.75" />
    <path d="m20.5 16-5-5-9.5 8.5" />
  </Icon>
);

/** Two sliders — settings for one thing. */
export const IconSliders = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);

export const IconPercent = (props: IconProps) => (
  <Icon {...props}>
    <path d="m18.5 5.5-13 13" />
    <circle cx="7" cy="7" r="2.25" />
    <circle cx="17" cy="17" r="2.25" />
  </Icon>
);

export const IconTruck = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 6.5h11v10H3zM14 10h4l3 3.5v3h-7" />
    <circle cx="7" cy="18" r="1.75" />
    <circle cx="17.5" cy="18" r="1.75" />
  </Icon>
);

export const IconFire = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4.5-4-6.5-4.5-11-3 2-5 5-5 8-1-1-1.5-2-1.5-3.5-1.5 1.5-2 4-2 6.5A6.5 6.5 0 0 0 12 21Z" />
  </Icon>
);

export const IconTrophy = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5" />
    <path d="M12 14v3.5M8.5 20.5h7M9.5 17.5h5" />
  </Icon>
);

export const IconUserPlus = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9.5" cy="8" r="3.5" />
    <path d="M3.5 20a6 6 0 0 1 12 0" />
    <path d="M19 8v6M16 11h6" />
  </Icon>
);

export const IconLayers = (props: IconProps) => (
  <Icon {...props}>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
  </Icon>
);

/** A drawn shape with vertices — delivery zone editor. */
export const IconPolygon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 5 12 2 2.5 10L9 20 3.5 12z" />
    <circle cx="6" cy="5" r="1.25" />
    <circle cx="18" cy="7" r="1.25" />
    <circle cx="20.5" cy="17" r="1.25" />
    <circle cx="9" cy="20" r="1.25" />
    <circle cx="3.5" cy="12" r="1.25" />
  </Icon>
);

export const IconHourglass = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 3.5h11M6.5 20.5h11" />
    <path d="M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5" />
  </Icon>
);

export const IconHistory = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3.5 4v4.5H8" />
    <path d="M12 8v4.5l3 2" />
  </Icon>
);

export const IconNavigation = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4 11 16-7-7 16-2-7z" />
  </Icon>
);

/** Three bars — opens the navigation on a narrow screen. */
export const IconBars = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </Icon>
);

export const IconCommand = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 9h6v6H9z" />
    <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9ZM15 9V6.5A2.5 2.5 0 1 1 17.5 9H15ZM9 15v2.5A2.5 2.5 0 1 1 6.5 15H9ZM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15Z" />
  </Icon>
);
