import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import {
  OrderType,
  type CheckoutPaymentOption,
  type CreateOrderItemRequest,
  type MenuProduct,
} from '@restor/shared-types';
import { cartLineKey, estimateUnitPrice } from '@restor/shared-utils';
import { load, save } from '../lib/storage';
import { uuid } from '../lib/uuid';
import { useSession } from './session';

/**
 * The cart, kept as WHAT was chosen — product, size, modifier ids, quantity —
 * and never as what it costs. Names and prices are read from the live menu
 * every time it is shown, so a price change or a sold-out dish shows up
 * instead of a stale number; the server prices the order again regardless.
 *
 * Persisted per restaurant and Telegram user, with the half-filled checkout,
 * so closing the sheet by accident loses nothing.
 */

export interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
  addedAt: number;
}

/** What the customer filled in on the checkout screen so far. */
export interface CheckoutDraft {
  type: typeof OrderType.DELIVERY | typeof OrderType.PICKUP;
  addressId: string | null;
  apartment: string;
  entrance: string;
  floor: string;
  intercom: string;
  courierComment: string;
  leaveAtDoor: boolean;
  paymentOption: CheckoutPaymentOption | null;
  promoCode: string;
}

interface CartState {
  lines: CartLine[];
  /** Note to the restaurant. */
  comment: string;
  /** Sets of cutlery; starts at 1. */
  cutlery: number;
  draft: CheckoutDraft;
  /**
   * The idempotency key of the checkout in flight, with a fingerprint of what
   * it was for. Reused while the order is unchanged — a retry after a lost
   * response must return the same order — and replaced when anything changes.
   */
  pending: { uuid: string; fingerprint: string } | null;
}

const EMPTY_DRAFT: CheckoutDraft = {
  type: OrderType.DELIVERY,
  addressId: null,
  apartment: '',
  entrance: '',
  floor: '',
  intercom: '',
  courierComment: '',
  leaveAtDoor: false,
  paymentOption: null,
  promoCode: '',
};

const EMPTY: CartState = { lines: [], comment: '', cutlery: 1, draft: EMPTY_DRAFT, pending: null };

type Action =
  | { type: 'add'; productId: string; variantId: string | null; modifierIds: string[]; quantity: number }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'replace'; key: string; variantId: string | null; modifierIds: string[]; quantity: number }
  | { type: 'decrementProduct'; productId: string }
  | { type: 'remove'; keys: string[] }
  | { type: 'clear' }
  | { type: 'comment'; value: string }
  | { type: 'cutlery'; value: number }
  | { type: 'draft'; patch: Partial<CheckoutDraft> }
  | { type: 'pending'; value: CartState['pending'] }
  | { type: 'placed' };

function reducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case 'add': {
      const key = cartLineKey(action.productId, action.variantId, action.modifierIds);
      const existing = state.lines.find((line) => line.key === key);
      const lines = existing
        ? state.lines.map((line) =>
            line.key === key
              ? { ...line, quantity: Math.min(999, line.quantity + action.quantity), addedAt: Date.now() }
              : line,
          )
        : [
            ...state.lines,
            {
              key,
              productId: action.productId,
              variantId: action.variantId,
              modifierIds: [...action.modifierIds].sort(),
              quantity: action.quantity,
              addedAt: Date.now(),
            },
          ];
      return { ...state, lines };
    }
    case 'setQuantity':
      return {
        ...state,
        lines: state.lines
          .map((line) => (line.key === action.key ? { ...line, quantity: Math.min(999, action.quantity) } : line))
          .filter((line) => line.quantity > 0),
      };
    case 'replace': {
      // Editing a line can turn it into a configuration already in the cart;
      // the two then merge rather than sit side by side.
      const nextKey = cartLineKey(
        state.lines.find((line) => line.key === action.key)?.productId ?? '',
        action.variantId,
        action.modifierIds,
      );
      const original = state.lines.find((line) => line.key === action.key);
      if (!original) return state;
      const others = state.lines.filter((line) => line.key !== action.key);
      const twin = others.find((line) => line.key === nextKey);
      const lines = twin
        ? others.map((line) =>
            line.key === nextKey ? { ...line, quantity: Math.min(999, line.quantity + action.quantity) } : line,
          )
        : state.lines.map((line) =>
            line.key === action.key
              ? {
                  ...line,
                  key: nextKey,
                  variantId: action.variantId,
                  modifierIds: [...action.modifierIds].sort(),
                  quantity: action.quantity,
                }
              : line,
          );
      return { ...state, lines: lines.filter((line) => line.quantity > 0) };
    }
    case 'decrementProduct': {
      // "−" on a menu card: the most recently added configuration goes first.
      const candidates = state.lines.filter((line) => line.productId === action.productId);
      if (candidates.length === 0) return state;
      const latest = candidates.reduce((a, b) => (b.addedAt > a.addedAt ? b : a));
      return reducer(state, { type: 'setQuantity', key: latest.key, quantity: latest.quantity - 1 });
    }
    case 'remove':
      return { ...state, lines: state.lines.filter((line) => !action.keys.includes(line.key)) };
    case 'clear':
      return { ...state, lines: [], comment: '', pending: null };
    case 'comment':
      return { ...state, comment: action.value };
    case 'cutlery':
      return { ...state, cutlery: Math.max(0, Math.min(20, action.value)) };
    case 'draft':
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case 'pending':
      return { ...state, pending: action.value };
    case 'placed':
      // The order exists: start the next one clean, but keep where the
      // customer lives and how they like to pay.
      return {
        ...EMPTY,
        draft: {
          ...state.draft,
          courierComment: '',
          promoCode: '',
          leaveAtDoor: false,
        },
      };
    default:
      return state;
  }
}

/** A cart line joined with the live menu. */
export interface PricedLine extends CartLine {
  product: MenuProduct | null;
  /** Sold out, removed, or its options changed since it was added. */
  unavailable: boolean;
  variantName: string | null;
  modifierNames: string[];
  unitPrice: number;
  total: number;
}

interface CartApi {
  state: CartState;
  lines: PricedLine[];
  /** Lines that can still be ordered. */
  orderable: PricedLine[];
  count: number;
  /** On-screen estimate only; the server's preview is what is charged. */
  estimate: number;
  quantityOf: (productId: string) => number;
  add: (product: MenuProduct, variantId: string | null, modifierIds: string[], quantity?: number) => void;
  setQuantity: (key: string, quantity: number) => void;
  replace: (key: string, variantId: string | null, modifierIds: string[], quantity: number) => void;
  decrementProduct: (productId: string) => void;
  remove: (keys: string[]) => void;
  clear: () => void;
  setComment: (value: string) => void;
  setCutlery: (value: number) => void;
  updateDraft: (patch: Partial<CheckoutDraft>) => void;
  /** The order's items as the API wants them. */
  items: CreateOrderItemRequest[];
  /** Idempotency key for this exact checkout; the same until it changes. */
  idempotencyKeyFor: (fingerprint: string) => string;
  markPlaced: () => void;
}

const CartContext = createContext<CartApi | null>(null);

export function useCart(): CartApi {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart outside CartProvider');
  return cart;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { products } = useSession();
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    ...EMPTY,
    ...load<Partial<CartState>>('cart', {}),
    draft: { ...EMPTY_DRAFT, ...load<Partial<CartState>>('cart', {}).draft },
  }));

  useEffect(() => save('cart', state), [state]);

  const lines = useMemo<PricedLine[]>(
    () =>
      state.lines.map((line) => {
        const product = products.get(line.productId)?.product ?? null;
        const variant = product?.variants.find((entry) => entry.id === line.variantId) ?? null;
        const allModifiers = product?.modifierGroups.flatMap((group) => group.modifiers) ?? [];
        const modifiers = allModifiers.filter((modifier) => line.modifierIds.includes(modifier.id));

        const unavailable =
          !product ||
          (line.variantId !== null && !variant) ||
          modifiers.length !== line.modifierIds.length;

        const unitPrice = product && !unavailable ? estimateUnitPrice(product, line.variantId, line.modifierIds) : 0;

        return {
          ...line,
          product,
          unavailable,
          variantName: variant && product && product.variants.length > 1 ? variant.name : null,
          modifierNames: modifiers.map((modifier) => modifier.name),
          unitPrice,
          total: unitPrice * line.quantity,
        };
      }),
    [state.lines, products],
  );

  const orderable = useMemo(() => lines.filter((line) => !line.unavailable), [lines]);

  const count = orderable.reduce((sum, line) => sum + line.quantity, 0);
  const estimate = orderable.reduce((sum, line) => sum + line.total, 0);

  const quantityOf = useCallback(
    (productId: string) =>
      state.lines.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0),
    [state.lines],
  );

  const items = useMemo<CreateOrderItemRequest[]>(
    () =>
      orderable.map((line) => ({
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        quantity: line.quantity,
        modifierIds: line.modifierIds,
      })),
    [orderable],
  );

  // Read and written synchronously: a second tap inside the same frame must
  // get the key the first one just created, not mint another.
  //
  // The ref runs ahead of state only between a dispatch and the next render;
  // each render re-syncs it, so a placed order's key is never reused.
  const pendingRef = useRef(state.pending);
  pendingRef.current = state.pending;
  const idempotencyKeyFor = useCallback((fingerprint: string) => {
    const pending = pendingRef.current;
    if (pending && pending.fingerprint === fingerprint) return pending.uuid;
    const value = { uuid: uuid(), fingerprint };
    pendingRef.current = value;
    dispatch({ type: 'pending', value });
    return value.uuid;
  }, []);

  const api = useMemo<CartApi>(
    () => ({
      state,
      lines,
      orderable,
      count,
      estimate,
      quantityOf,
      add: (product, variantId, modifierIds, quantity = 1) =>
        dispatch({ type: 'add', productId: product.id, variantId, modifierIds, quantity }),
      setQuantity: (key, quantity) => dispatch({ type: 'setQuantity', key, quantity }),
      replace: (key, variantId, modifierIds, quantity) =>
        dispatch({ type: 'replace', key, variantId, modifierIds, quantity }),
      decrementProduct: (productId) => dispatch({ type: 'decrementProduct', productId }),
      remove: (keys) => dispatch({ type: 'remove', keys }),
      clear: () => dispatch({ type: 'clear' }),
      setComment: (value) => dispatch({ type: 'comment', value }),
      setCutlery: (value) => dispatch({ type: 'cutlery', value }),
      updateDraft: (patch) => dispatch({ type: 'draft', patch }),
      items,
      idempotencyKeyFor,
      markPlaced: () => dispatch({ type: 'placed' }),
    }),
    [state, lines, orderable, count, estimate, quantityOf, items, idempotencyKeyFor],
  );

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}
