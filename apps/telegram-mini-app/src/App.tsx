import { Suspense, lazy, useEffect, useRef } from 'react';
import { IconTelegram } from '@restor/ui';
import { ProductSheetProvider, useProductSheet } from './components/ProductSheet';
import { ToastProvider } from './components/Toast';
import { ListSkeleton } from './components/ui';
import { NavigatorProvider, routeKey, useNav, type Route } from './lib/nav';
import { AddressesScreen } from './screens/AddressesScreen';
import { CartScreen } from './screens/CartScreen';
import { CheckoutScreen } from './screens/CheckoutScreen';
import { FavoritesScreen } from './screens/FavoritesScreen';
import { AboutScreen, HelpScreen } from './screens/InfoScreens';
import { MenuScreen } from './screens/MenuScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { OrderScreen } from './screens/OrderScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { PromoCodesScreen } from './screens/PromoCodesScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CartProvider } from './state/cart';
import { SessionProvider, useSession } from './state/session';

/**
 * The address editor carries the map (Leaflet), which nobody needs to see the
 * menu — so it loads the first time an address is added or edited.
 */
const AddressEditorScreen = lazy(() =>
  import('./screens/AddressEditorScreen').then((module) => ({ default: module.AddressEditorScreen })),
);

/**
 * Telegram Mini App (TZ §48, TZ 48).
 *
 * Sign-in is the whole Telegram integration: `initData` goes to the backend,
 * which verifies its HMAC before creating or matching the customer. Nothing
 * here decides who the user is.
 *
 * A link can open a specific screen — the bot's "Buyurtmani ochish" button
 * carries `?order=`, a campaign's carries `?product=`.
 */
export function App() {
  return (
    <ToastProvider>
      <SessionProvider splash={<Splash />} failure={(message, retry) => <Failure message={message} retry={retry} />}>
        <CartProvider>
          <NavigatorProvider initial={initialStack()}>
            <ProductSheetProvider>
              <Screens />
              <DeepLinkProduct />
            </ProductSheetProvider>
          </NavigatorProvider>
        </CartProvider>
      </SessionProvider>
    </ToastProvider>
  );
}

function initialStack(): Route[] {
  const orderId = new URLSearchParams(window.location.search).get('order');
  return orderId && /^[0-9a-f-]{36}$/i.test(orderId)
    ? [{ name: 'menu' }, { name: 'order', id: orderId }]
    : [{ name: 'menu' }];
}

/** `?product=` opens that dish's sheet once the menu has loaded. */
function DeepLinkProduct() {
  const session = useSession();
  const sheet = useProductSheet();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !session.menu) return;
    done.current = true;
    const productId = new URLSearchParams(window.location.search).get('product');
    const product = productId ? session.products.get(productId)?.product : undefined;
    if (product) sheet.openProduct(product);
  }, [session.menu, session.products, sheet]);

  return null;
}

/**
 * Every screen on the stack stays mounted; only the top one is shown. Going
 * back therefore finds the menu exactly as it was left.
 */
function Screens() {
  const nav = useNav();
  return (
    <>
      {nav.stack.map((route, index) => {
        const active = index === nav.stack.length - 1;
        return (
          <div key={`${index}:${routeKey(route)}`} className="screen-slot" hidden={!active}>
            {renderRoute(route, active)}
          </div>
        );
      })}
    </>
  );
}

function renderRoute(route: Route, active: boolean) {
  switch (route.name) {
    case 'menu':
      return <MenuScreen active={active} />;
    case 'search':
      return <SearchScreen active={active} />;
    case 'cart':
      return <CartScreen />;
    case 'checkout':
      return <CheckoutScreen active={active} />;
    case 'order':
      return <OrderScreen id={route.id} justPlaced={route.justPlaced} active={active} />;
    case 'orders':
      return <OrdersScreen active={active} />;
    case 'profile':
      return <ProfileScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'addresses':
      return <AddressesScreen picking={route.picking} active={active} />;
    case 'address-edit':
      return (
        <Suspense fallback={<ListSkeleton rows={4} />}>
          <AddressEditorScreen id={route.id} fromCheckout={route.fromCheckout} />
        </Suspense>
      );
    case 'favorites':
      return <FavoritesScreen active={active} />;
    case 'notifications':
      return <NotificationsScreen active={active} />;
    case 'promo-codes':
      return <PromoCodesScreen active={active} />;
    case 'help':
      return <HelpScreen />;
    case 'about':
      return <AboutScreen />;
    default:
      return null;
  }
}

function Splash() {
  return (
    <div className="splash" aria-busy="true" aria-label="Yuklanmoqda">
      <div className="splash__spinner" />
    </div>
  );
}

function Failure({ message, retry }: { message: string; retry: (() => void) | null }) {
  return (
    <div className="splash">
      <div className="splash__card" role="alert">
        <IconTelegram size={40} strokeWidth={1.5} />
        <p>{message}</p>
        {retry && (
          <button type="button" className="btn btn--primary" onClick={retry}>
            Qayta urinish
          </button>
        )}
      </div>
    </div>
  );
}
