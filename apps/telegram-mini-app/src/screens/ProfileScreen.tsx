import type { ComponentType } from 'react';
import { fullNameOf } from '@restor/shared-utils';
import {
  IconBell,
  IconChevronRight,
  IconHeart,
  IconHelp,
  IconInfo,
  IconMapPin,
  IconOrders,
  IconTag,
  type IconProps,
} from '@restor/ui';
import { ScreenHeader } from '../components/ui';
import { initials } from '../lib/format';
import { useNav, type Route } from '../lib/nav';
import { useSession } from '../state/session';

interface MenuItem {
  label: string;
  Icon: ComponentType<IconProps>;
  route: Route;
  badge?: number;
}

/**
 * The customer's profile (TZ 48 §12). Only what RESTOR actually offers —
 * no "work with us" or "become a courier".
 */
export function ProfileScreen() {
  const session = useSession();
  const nav = useNav();
  const { profile } = session;

  const name =
    fullNameOf(profile) ??
    ([profile.telegram.firstName, profile.telegram.lastName].filter(Boolean).join(' ') || 'Mehmon');

  const items: MenuItem[] = [
    { label: 'Buyurtmalar tarixi', Icon: IconOrders, route: { name: 'orders' } },
    { label: 'Yordam xizmati', Icon: IconHelp, route: { name: 'help' } },
    { label: 'Tanlanganlar', Icon: IconHeart, route: { name: 'favorites' } },
    { label: 'Bildirishnomalar', Icon: IconBell, route: { name: 'notifications' }, badge: session.unread },
    { label: 'Promo-kodlar', Icon: IconTag, route: { name: 'promo-codes' } },
    { label: 'Manzillarim', Icon: IconMapPin, route: { name: 'addresses' } },
    { label: 'Xizmat haqida', Icon: IconInfo, route: { name: 'about' } },
  ];

  return (
    <div className="screen screen--tinted">
      <ScreenHeader title="Profil" />

      <button type="button" className="profile-head" onClick={() => nav.push({ name: 'settings' })}>
        {profile.telegram.photoUrl ? (
          <img className="avatar" src={profile.telegram.photoUrl} alt="" />
        ) : (
          <span className="avatar avatar--initials" aria-hidden="true">
            {initials(name)}
          </span>
        )}
        <span className="profile-head__text">
          <span className="profile-head__name">{name}</span>
          <span className="profile-head__link">
            Sozlamalar <IconChevronRight size={14} />
          </span>
        </span>
      </button>

      {profile.missingFields.length > 0 && (
        <button type="button" className="notice notice--action" onClick={() => nav.push({ name: 'settings' })}>
          Buyurtma berish uchun ism, familiya va telefon raqamingizni kiriting
          <IconChevronRight size={16} />
        </button>
      )}

      <nav className="menu-list" aria-label="Profil boʻlimlari">
        {items.map(({ label, Icon, route, badge }) => (
          <button key={label} type="button" className="menu-list__item" onClick={() => nav.push(route)}>
            <Icon size={22} />
            <span className="menu-list__label">
              {label}
              {badge ? <span className="count-badge">{badge > 99 ? '99+' : badge}</span> : null}
            </span>
            <IconChevronRight size={18} />
          </button>
        ))}
      </nav>
    </div>
  );
}
