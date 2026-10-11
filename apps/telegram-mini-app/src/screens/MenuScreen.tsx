import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuProduct } from '@restor/shared-types';
import {
  IconBasket,
  IconChevronRight,
  IconClock,
  IconHeart,
  IconInfo,
  IconMapPin,
  IconSearch,
  IconUser,
} from '@restor/ui';
import { BottomSheet } from '../components/BottomSheet';
import { ProductCard, useQuickAdd } from '../components/product';
import { useProductSheet } from '../components/ProductSheet';
import { ErrorState, Skeleton } from '../components/ui';
import { som } from '../lib/format';
import { useNav } from '../lib/nav';
import { useCart } from '../state/cart';
import { useSession } from '../state/session';

/** Pixels under the sticky header and category bar a section's title lands at. */
function stickyOffset(): number {
  const header = document.querySelector<HTMLElement>('.menu-topbar')?.offsetHeight ?? 56;
  const nav = document.querySelector<HTMLElement>('.category-nav')?.offsetHeight ?? 48;
  return header + nav;
}

/**
 * The restaurant page (TZ 48 §2–§5, §9): who the restaurant is, its whole
 * menu as one continuous catalogue, and the floating cart.
 */
export function MenuScreen({ active }: { active: boolean }) {
  const session = useSession();
  const cart = useCart();
  const nav = useNav();
  const sheet = useProductSheet();
  const quickAdd = useQuickAdd(sheet.openProduct);

  const [compact, setCompact] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const categories = session.menu?.categories ?? [];
  const { restaurant } = session.info;

  // The big title gives way to a compact one once it has scrolled under the
  // sticky bar — the restaurant's name never leaves the screen.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || !active) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCompact(!entry!.isIntersecting),
      { rootMargin: '-56px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [active, session.menu]);

  const onDecrement = useCallback((productId: string) => cart.decrementProduct(productId), [cart]);

  return (
    <div className="screen screen--menu">
      <header className={`menu-topbar${compact ? ' menu-topbar--compact' : ''}`}>
        <div className="menu-topbar__brand">
          {restaurant.logoUrl ? (
            <img className="menu-topbar__logo" src={restaurant.logoUrl} alt="" />
          ) : (
            <span className="menu-topbar__logo menu-topbar__logo--text" aria-hidden="true">
              {restaurant.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="menu-topbar__name">{restaurant.name}</span>
        </div>
        <div className="menu-topbar__actions">
          <button type="button" className="icon-btn" aria-label="Qidirish" onClick={() => nav.push({ name: 'search' })}>
            <IconSearch size={22} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Tanlanganlar"
            onClick={() => nav.push({ name: 'favorites' })}
          >
            <IconHeart size={22} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={session.unread > 0 ? `Profil, ${session.unread} ta yangi xabar` : 'Profil'}
            onClick={() => nav.push({ name: 'profile' })}
          >
            <IconUser size={22} />
            {session.unread > 0 && <span className="dot-badge">{session.unread > 9 ? '9+' : session.unread}</span>}
          </button>
        </div>
      </header>

      <div ref={heroRef} className="hero">
        <h1 className="hero__title">{restaurant.name}</h1>
        {session.branch && (
          <button type="button" className="hero__branch" onClick={() => setInfoOpen(true)}>
            <IconMapPin size={16} />
            <span className="hero__branch-text">
              {session.branch.name}
              <span className="hero__branch-address"> · {session.branch.address}</span>
            </span>
            <IconChevronRight size={16} />
          </button>
        )}
        {session.branch && (
          <div className="hero__facts">
            <span className={`fact${session.branch.isOpenNow ? '' : ' fact--warn'}`}>
              {session.branch.isOpenNow ? 'Ochiq' : 'Hozir yopiq'}
            </span>
            <span className="fact">
              <IconClock size={14} />
              ~{session.branch.averagePrepMinutes} daq tayyorlanadi
            </span>
            {session.branch.acceptsDelivery && (
              <span className="fact">
                {session.branch.deliveryPrice > 0 ? `Yetkazish ${som(session.branch.deliveryPrice)} dan` : 'Bepul yetkazish'}
              </span>
            )}
            <button type="button" className="fact fact--button" onClick={() => setInfoOpen(true)}>
              <IconInfo size={14} />
              Maʼlumot
            </button>
          </div>
        )}
      </div>

      {session.menuError ? (
        <ErrorState message={session.menuError} onRetry={session.reloadMenu} />
      ) : !session.menu ? (
        <MenuSkeleton />
      ) : categories.length === 0 ? (
        <ErrorState message="Bu filialda hozircha menyu yoʻq" />
      ) : (
        <Catalogue
          active={active}
          onOpen={sheet.openProduct}
          onAdd={quickAdd}
          onDecrement={onDecrement}
          quantityOf={cart.quantityOf}
        />
      )}

      {cart.count > 0 && (
        <div className="floating-cart">
          <button type="button" className="floating-cart__btn" onClick={() => nav.push({ name: 'cart' })}>
            <span>{som(cart.estimate)}</span>
            <IconBasket size={22} strokeWidth={2} />
            <span className="floating-cart__count" aria-label={`${cart.count} ta mahsulot`}>
              {cart.count}
            </span>
          </button>
        </div>
      )}

      <RestaurantInfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}

/**
 * Every category as one continuous catalogue, with a sticky bar of category
 * names that follows the scroll.
 *
 * The active category is the last one whose title has passed under the
 * sticky bar, measured on each animation frame of a scroll — robust where an
 * IntersectionObserver per section flickers on short categories. A tap on a
 * category scrolls smoothly to it and holds that category active until the
 * scroll settles, so the bar does not stutter through the ones in between.
 */
function Catalogue({
  active,
  onOpen,
  onAdd,
  onDecrement,
  quantityOf,
}: {
  active: boolean;
  onOpen: (product: MenuProduct) => void;
  onAdd: (product: MenuProduct) => void;
  onDecrement: (productId: string) => void;
  quantityOf: (productId: string) => number;
}) {
  const session = useSession();
  const categories = session.menu!.categories;
  const [activeId, setActiveId] = useState(categories[0]?.id ?? '');
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const navRef = useRef<HTMLDivElement>(null);
  const lock = useRef<{ id: string; until: number } | null>(null);

  const measure = useCallback(() => {
    if (lock.current && Date.now() < lock.current.until) return;
    lock.current = null;

    const offset = stickyOffset() + 8;
    let current = categories[0]?.id ?? '';
    for (const category of categories) {
      const node = sectionRefs.current.get(category.id);
      if (node && node.getBoundingClientRect().top - offset <= 0) current = category.id;
    }
    // At the very bottom the last short category can never reach the top;
    // reaching the end of the page makes it active anyway.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      current = categories[categories.length - 1]?.id ?? current;
    }
    setActiveId((previous) => (previous === current ? previous : current));
  }, [categories]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const onScrollEnd = () => {
      lock.current = null;
      measure();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    measure();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
      cancelAnimationFrame(frame);
    };
  }, [active, measure]);

  // Keep the active chip in view inside the horizontal bar.
  useLayoutEffect(() => {
    const chip = chipRefs.current.get(activeId);
    const bar = navRef.current;
    if (!chip || !bar) return;
    const left = chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [activeId]);

  function goTo(categoryId: string) {
    const node = sectionRefs.current.get(categoryId);
    if (!node) return;
    lock.current = { id: categoryId, until: Date.now() + 900 };
    setActiveId(categoryId);
    const top = node.getBoundingClientRect().top + window.scrollY - stickyOffset() + 1;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  return (
    <>
      <nav className="category-nav" aria-label="Kategoriyalar">
        <div ref={navRef} className="category-nav__track">
          {categories.map((category) => (
            <button
              key={category.id}
              ref={(node) => {
                if (node) chipRefs.current.set(category.id, node);
                else chipRefs.current.delete(category.id);
              }}
              type="button"
              className={`category-nav__item${category.id === activeId ? ' category-nav__item--active' : ''}`}
              aria-current={category.id === activeId ? 'true' : undefined}
              onClick={() => goTo(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      </nav>

      <div className="catalogue">
        {categories.map((category, categoryIndex) => (
          <section
            key={category.id}
            ref={(node) => {
              if (node) sectionRefs.current.set(category.id, node);
              else sectionRefs.current.delete(category.id);
            }}
            className="catalogue__section"
            aria-labelledby={`cat-${category.id}`}
          >
            <h2 id={`cat-${category.id}`} className="catalogue__title">
              {category.name}
            </h2>
            <div className="product-grid">
              {category.products.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={quantityOf(product.id)}
                  onOpen={onOpen}
                  onAdd={onAdd}
                  onDecrement={onDecrement}
                  eagerImage={categoryIndex === 0 && index < 4}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function MenuSkeleton() {
  return (
    <div className="catalogue" aria-label="Menyu yuklanmoqda">
      <div className="category-nav">
        <div className="category-nav__track">
          {[72, 64, 88, 70].map((width, index) => (
            <Skeleton key={index} width={width} height={20} />
          ))}
        </div>
      </div>
      <div className="product-grid" style={{ paddingTop: 16 }}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="product-card">
            <Skeleton height={150} radius={20} />
            <Skeleton height={16} width="50%" />
            <Skeleton height={14} width="80%" />
          </div>
        ))}
      </div>
    </div>
  );
}

const WEEKDAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

/** Restaurant details: branches (and switching between them), hours, terms. */
function RestaurantInfoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const cart = useCart();
  const branch = session.branch;

  return (
    <BottomSheet open={open} onClose={onClose} label="Restoran haqida">
      <div className="info-sheet">
        <h2 className="info-sheet__title">{session.info.restaurant.name}</h2>

        {session.branches.length > 1 && (
          <section className="info-sheet__section">
            <h3 className="section-label">Filialni tanlang</h3>
            {session.branches.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={entry.id === branch?.id}
                className={`option${entry.id === branch?.id ? ' option--checked' : ''}`}
                onClick={() => {
                  session.selectBranch(entry.id);
                  onClose();
                }}
              >
                <span className="option__control option__control--radio" aria-hidden="true" />
                <span className="option__label">
                  {entry.name}
                  <span className="option__sub">{entry.address}</span>
                </span>
                <span className={`fact${entry.isOpenNow ? '' : ' fact--warn'}`}>
                  {entry.isOpenNow ? 'Ochiq' : 'Yopiq'}
                </span>
              </button>
            ))}
            {cart.count > 0 && (
              <p className="hint">Savat saqlanadi; narx va mavjudlik tanlangan filial boʻyicha qayta hisoblanadi.</p>
            )}
          </section>
        )}

        {branch && (
          <>
            <section className="info-sheet__section">
              <h3 className="section-label">Manzil</h3>
              <p>{branch.address}</p>
              {(branch.phone ?? session.info.restaurant.phone) && (
                <a className="link" href={`tel:${branch.phone ?? session.info.restaurant.phone}`}>
                  {branch.phone ?? session.info.restaurant.phone}
                </a>
              )}
            </section>

            <section className="info-sheet__section">
              <h3 className="section-label">Yetkazib berish</h3>
              <dl className="kv">
                <div>
                  <dt>Yetkazish narxi</dt>
                  <dd>{branch.deliveryPrice > 0 ? `${som(branch.deliveryPrice)} dan` : 'Bepul'}</dd>
                </div>
                {branch.freeDeliveryFrom != null && (
                  <div>
                    <dt>Bepul yetkazish</dt>
                    <dd>{som(branch.freeDeliveryFrom)} dan</dd>
                  </div>
                )}
                {branch.minOrderAmount > 0 && (
                  <div>
                    <dt>Minimal buyurtma</dt>
                    <dd>{som(branch.minOrderAmount)}</dd>
                  </div>
                )}
                <div>
                  <dt>Tayyorlanish vaqti</dt>
                  <dd>~{branch.averagePrepMinutes} daqiqa</dd>
                </div>
              </dl>
              <p className="hint">Yakuniy yetkazish narxi manzilga qarab buyurtma rasmiylashtirilganda hisoblanadi.</p>
            </section>

            {branch.workingHours.length > 0 && (
              <section className="info-sheet__section">
                <h3 className="section-label">Ish vaqti</h3>
                <dl className="kv">
                  {branch.workingHours.map((hours) => (
                    <div key={hours.dayOfWeek}>
                      <dt>{WEEKDAYS[hours.dayOfWeek]}</dt>
                      <dd>{hours.isClosed ? 'Dam olish' : `${hours.opensAt} – ${hours.closesAt}`}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
