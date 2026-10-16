import { useState } from 'react';
import type { MenuProduct } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';

export interface ProductSelection { variantId: string | null; modifierIds: string[]; comment: string; }

export function ProductDialog({ product, onCancel, onConfirm }: {
  product: MenuProduct; onCancel: () => void; onConfirm: (selection: ProductSelection) => void;
}) {
  const [variantId, setVariantId] = useState(product.variants.find(v => v.isDefault)?.id ?? product.variants[0]?.id ?? null);
  const [modifierIds, setModifierIds] = useState<string[]>(product.modifierGroups.flatMap(group => group.modifiers.filter(m => m.isDefault).slice(0, group.maxSelect).map(m => m.id)));
  const [comment, setComment] = useState('');
  const valid = product.modifierGroups.every(group => {
    const count = group.modifiers.filter(m => modifierIds.includes(m.id)).length;
    return count >= group.minSelect && count <= group.maxSelect;
  });
  const estimate = Math.max(0, product.price + (product.variants.find(v => v.id === variantId)?.priceDelta ?? 0)) + product.modifierGroups.flatMap(g => g.modifiers).filter(m => modifierIds.includes(m.id)).reduce((sum, m) => sum + m.price, 0);
  return <div className="pay-overlay" role="dialog" aria-modal="true" aria-label="Mahsulot tanlash"><div className="pay-sheet">
    <div className="pay-sheet__head"><h2>{product.name}</h2><button className="qty-btn" onClick={onCancel} aria-label="Yopish">×</button></div>
    {product.variants.length > 0 && <fieldset><legend>Variant</legend>{product.variants.map(v => <label className="product-option" key={v.id}><input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />{v.name}<span>{formatMoney(Math.max(0, product.price + v.priceDelta))}</span></label>)}</fieldset>}
    {product.modifierGroups.map(group => <fieldset key={group.id}><legend>{group.name} ({group.minSelect}–{group.maxSelect} ta)</legend>{group.modifiers.map(modifier => {
      const selected = modifierIds.includes(modifier.id);
      const count = group.modifiers.filter(m => modifierIds.includes(m.id)).length;
      return <label className="product-option" key={modifier.id}><input type="checkbox" checked={selected} disabled={!selected && group.maxSelect !== 1 && count >= group.maxSelect} onChange={() => setModifierIds(current => selected ? current.filter(id => id !== modifier.id) : [...(group.maxSelect === 1 ? current.filter(id => !group.modifiers.some(m => m.id === id)) : current), modifier.id])} />{modifier.name}<span>+{formatMoney(modifier.price)}</span></label>;
    })}</fieldset>)}
    <label className="pay-section">Oshxona uchun izoh<input className="pay-input" value={comment} maxLength={500} onChange={event => setComment(event.target.value)} placeholder="Masalan: piyozsiz" /></label>
    <p className="cart__meta">Taxminiy summa: {formatMoney(estimate)}</p>
    <div className="pay-actions"><button className="pay-btn" onClick={onCancel}>Bekor qilish</button><button className="pay-btn pay-btn--primary" disabled={!valid} onClick={() => onConfirm({ variantId, modifierIds, comment })}>Savatga qo‘shish</button></div>
  </div></div>;
}
