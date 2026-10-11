import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MenuModifierGroup, MenuProduct } from '@restor/shared-types';
import {
  defaultModifierIds,
  defaultVariantId,
  estimateUnitPrice,
  formatPortion,
  isSingleChoiceGroup,
  requirementLabel,
  validateModifierSelection,
} from '@restor/shared-utils';
import { IconCheck, IconHeart, IconHeartFilled } from '@restor/ui';
import { errorMessage } from '../lib/errors';
import { som } from '../lib/format';
import { useCart, type PricedLine } from '../state/cart';
import { useSession } from '../state/session';
import { haptic, hapticResult } from '../telegram';
import { BottomSheet } from './BottomSheet';
import { ProductImage, RecommendationRow, useQuickAdd } from './product';
import { useToast } from './Toast';
import { QtyStepper } from './ui';

interface SheetState {
  product: MenuProduct;
  /** Set when editing an existing cart line. */
  editing: PricedLine | null;
}

interface ProductSheetApi {
  openProduct: (product: MenuProduct) => void;
  editLine: (line: PricedLine) => void;
}

const ProductSheetContext = createContext<ProductSheetApi>({
  openProduct: () => undefined,
  editLine: () => undefined,
});

export function useProductSheet(): ProductSheetApi {
  return useContext(ProductSheetContext);
}

/** One product sheet for the whole app, opened from anywhere. */
export function ProductSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SheetState | null>(null);

  const openProduct = useCallback((product: MenuProduct) => setState({ product, editing: null }), []);
  const editLine = useCallback((line: PricedLine) => {
    if (line.product) setState({ product: line.product, editing: line });
  }, []);
  const close = useCallback(() => setState(null), []);

  const api = useMemo(() => ({ openProduct, editLine }), [openProduct, editLine]);

  return (
    <ProductSheetContext.Provider value={api}>
      {children}
      <BottomSheet open={state !== null} onClose={close} label={state?.product.name ?? 'Mahsulot'}>
        {state && (
          <ProductSheetBody
            key={`${state.product.id}:${state.editing?.key ?? 'new'}`}
            state={state}
            onSwitch={openProduct}
            onDone={close}
          />
        )}
      </BottomSheet>
    </ProductSheetContext.Provider>
  );
}

/**
 * What is inside the sheet: photo, name, description, portion, the size and
 * option groups, recommendations, and the quantity + add/save bar.
 *
 * The add button is enabled only when the selection passes the SAME check
 * the server runs (`validateModifierSelection` from shared-utils). Tapping it
 * while something required is missing shows what is missing and scrolls to
 * it, instead of silently doing nothing.
 */
function ProductSheetBody({
  state,
  onSwitch,
  onDone,
}: {
  state: SheetState;
  onSwitch: (product: MenuProduct) => void;
  onDone: () => void;
}) {
  const { product, editing } = state;
  const cart = useCart();
  const session = useSession();
  const toast = useToast();
  const quickAdd = useQuickAdd(onSwitch);

  const [variantId, setVariantId] = useState<string | null>(
    editing ? editing.variantId : defaultVariantId(product),
  );
  const [selected, setSelected] = useState<string[]>(
    editing ? editing.modifierIds : defaultModifierIds(product.modifierGroups),
  );
  const [quantity, setQuantity] = useState(editing ? editing.quantity : 1);
  const [showIssues, setShowIssues] = useState(false);
  const groupRefs = useRef(new Map<string, HTMLElement>());

  const issues = useMemo(
    () => validateModifierSelection(product.modifierGroups, selected),
    [product.modifierGroups, selected],
  );
  const issueFor = (groupId: string) => issues.find((issue) => issue.groupId === groupId);

  const unitPrice = estimateUnitPrice(product, variantId, selected);
  const total = unitPrice * quantity;
  const portion = formatPortion(product.portionSize, product.portionUnit);
  const isFavorite = session.favoriteIds.has(product.id);

  const recommendations = useMemo(() => {
    const ids =
      session.menu?.recommendations.byProduct[product.id] ??
      session.menu?.recommendations.productDefault ??
      [];
    return ids
      .filter((id) => id !== product.id)
      .map((id) => session.products.get(id)?.product)
      .filter((entry): entry is MenuProduct => Boolean(entry))
      .slice(0, 12);
  }, [session.menu, session.products, product.id]);

  useEffect(() => {
    if (!showIssues || issues.length === 0) return;
    const first = groupRefs.current.get(issues[0]!.groupId);
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [showIssues, issues]);

  function toggle(group: MenuModifierGroup, modifierId: string) {
    haptic('light');
    const inGroup = new Set(group.modifiers.map((modifier) => modifier.id));
    const isOn = selected.includes(modifierId);

    if (isSingleChoiceGroup(group)) {
      // A radio group: picking replaces; an optional one can be cleared by
      // tapping the chosen option again.
      const others = selected.filter((id) => !inGroup.has(id));
      setSelected(isOn && group.minSelect === 0 ? others : [...others, modifierId]);
      return;
    }

    setSelected(isOn ? selected.filter((id) => id !== modifierId) : [...selected, modifierId]);
  }

  function submit() {
    if (issues.length > 0) {
      setShowIssues(true);
      hapticResult('warning');
      return;
    }

    if (editing) {
      cart.replace(editing.key, variantId, selected, quantity);
    } else {
      cart.add(product, variantId, selected, quantity);
    }
    hapticResult('success');
    onDone();
  }

  async function toggleFavorite() {
    haptic('light');
    try {
      await session.toggleFavorite(product.id);
    } catch (error) {
      toast.show(errorMessage(error), 'error');
    }
  }

  return (
    <div className="product-sheet">
      <div className="product-sheet__media">
        <ProductImage src={product.imageUrl} alt={product.name} eager />
      </div>

      <div className="product-sheet__head">
        <div className="product-sheet__titles">
          <h2 className="product-sheet__name">{product.name}</h2>
          <div className="product-sheet__meta">
            <strong>{som(product.price)}</strong>
            {product.oldPrice && <s>{som(product.oldPrice)}</s>}
            {portion && <span>· {portion}</span>}
          </div>
        </div>
        <button
          type="button"
          className={`icon-btn icon-btn--soft${isFavorite ? ' icon-btn--active' : ''}`}
          aria-label={isFavorite ? 'Tanlanganlardan olib tashlash' : 'Tanlanganlarga qoʻshish'}
          aria-pressed={isFavorite}
          onClick={() => void toggleFavorite()}
        >
          {isFavorite ? <IconHeartFilled size={22} /> : <IconHeart size={22} />}
        </button>
      </div>

      {product.description && <p className="product-sheet__desc">{product.description}</p>}

      {product.variants.length > 1 && (
        <section className="option-group">
          <div className="option-group__head">
            <h3 className="option-group__title">Oʻlcham</h3>
            <span className="option-group__hint">Bittasini tanlang</span>
          </div>
          {product.variants.map((variant) => {
            const checked = variant.id === variantId;
            const price = Math.max(0, product.price + variant.priceDelta);
            return (
              <button
                key={variant.id}
                type="button"
                role="radio"
                aria-checked={checked}
                className={`option${checked ? ' option--checked' : ''}`}
                onClick={() => {
                  haptic('light');
                  setVariantId(variant.id);
                }}
              >
                <span className="option__control option__control--radio" aria-hidden="true" />
                <span className="option__label">{variant.name}</span>
                <span className="option__price">{som(price)}</span>
              </button>
            );
          })}
        </section>
      )}

      {product.modifierGroups.map((group) => {
        const issue = showIssues ? issueFor(group.id) : undefined;
        const single = isSingleChoiceGroup(group);
        const chosen = group.modifiers.filter((modifier) => selected.includes(modifier.id)).length;
        const atMax = !single && chosen >= group.maxSelect;

        return (
          <section
            key={group.id}
            ref={(node) => {
              if (node) groupRefs.current.set(group.id, node);
              else groupRefs.current.delete(group.id);
            }}
            className={`option-group${issue ? ' option-group--invalid' : ''}`}
            role={single ? 'radiogroup' : 'group'}
            aria-label={group.name}
          >
            <div className="option-group__head">
              <h3 className="option-group__title">{group.name}</h3>
              <span className="option-group__hint">{issue?.message ?? requirementLabel(group)}</span>
            </div>

            {group.modifiers.map((modifier) => {
              const checked = selected.includes(modifier.id);
              const disabled = atMax && !checked;
              return (
                <button
                  key={modifier.id}
                  type="button"
                  role={single ? 'radio' : 'checkbox'}
                  aria-checked={checked}
                  disabled={disabled}
                  className={`option${checked ? ' option--checked' : ''}`}
                  onClick={() => toggle(group, modifier.id)}
                >
                  <span
                    className={`option__control option__control--${single ? 'radio' : 'check'}`}
                    aria-hidden="true"
                  >
                    {!single && checked && <IconCheck size={14} strokeWidth={3} />}
                  </span>
                  <span className="option__label">{modifier.name}</span>
                  {modifier.price > 0 && <span className="option__price">+{som(modifier.price)}</span>}
                </button>
              );
            })}
          </section>
        );
      })}

      <RecommendationRow
        title="Sizga yoqishi mumkin"
        products={recommendations}
        onOpen={onSwitch}
        onAdd={(entry) => {
          quickAdd(entry);
          toast.show(`${entry.name} savatga qoʻshildi`, 'success');
        }}
      />

      <div className="product-sheet__bar">
        <div className="product-sheet__summary">
          <span className="product-sheet__summary-name">
            {product.name}
            {portion && <span className="muted"> {portion}</span>}
          </span>
          <strong className="product-sheet__summary-total">{som(total)}</strong>
        </div>
        <div className="product-sheet__actions">
          <QtyStepper
            value={quantity}
            min={1}
            size="lg"
            label="Miqdor"
            onDecrement={() => setQuantity((n) => Math.max(1, n - 1))}
            onIncrement={() => setQuantity((n) => Math.min(99, n + 1))}
          />
          <button
            type="button"
            className={`btn btn--primary btn--grow btn--center${issues.length > 0 ? ' btn--pending' : ''}`}
            onClick={submit}
          >
            {issues.length > 0 ? 'Variantlarni tanlang' : editing ? 'Saqlash' : 'Savatga qoʻshish'}
          </button>
        </div>
      </div>
    </div>
  );
}
