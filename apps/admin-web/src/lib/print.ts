import type { Order } from '@restor/shared-types';
import { dateTimeOf, som } from './format';
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from './labels';

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Prints a kitchen/customer receipt for one order.
 *
 * A throwaway window sized for an 80 mm thermal roll, printed through the OS
 * queue like the POS does — whatever printer sits on that desk is reached
 * without a driver of our own. Every figure is the server's; nothing is
 * recomputed here.
 */
export function printOrder(order: Order, restaurantName: string) {
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) return false;

  const lines = order.items
    .map(
      (item) => `
      <tr><td>${item.quantity} × ${escape(item.name)}${item.variantName ? ` (${escape(item.variantName)})` : ''}
        ${item.modifiers.length ? `<div class="mod">+ ${item.modifiers.map((m) => escape(m.name)).join(', ')}</div>` : ''}
        ${item.comment ? `<div class="mod">${escape(item.comment)}</div>` : ''}
      </td><td class="r">${som(item.total)}</td></tr>`,
    )
    .join('');

  const address = order.deliveryAddress
    ? [
        order.deliveryAddress.address,
        order.deliveryAddress.entrance && `${order.deliveryAddress.entrance}-podyezd`,
        order.deliveryAddress.floor && `${order.deliveryAddress.floor}-qavat`,
        order.deliveryAddress.apartment && `${order.deliveryAddress.apartment}-xonadon`,
      ]
        .filter(Boolean)
        .join(', ')
    : null;

  win.document.write(`<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>#${escape(order.displayNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font: 12px/1.35 ui-monospace, Consolas, monospace; color: #000; margin: 0; width: 72mm; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; vertical-align: top; }
  .big { font-size: 20px; font-weight: 700; text-align: center; margin: 6px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } td { padding: 2px 0; vertical-align: top; }
  .mod { font-size: 11px; padding-left: 10px; }
  .tot td { font-weight: 700; font-size: 14px; }
</style></head><body>
  <h1>${escape(restaurantName)}</h1>
  <div class="c">${escape(order.branch?.name ?? '')}</div>
  <div class="big">#${escape(order.displayNumber)}</div>
  <div class="c">${escape(ORDER_TYPE_LABELS[order.type] ?? order.type)}${order.tableNumber ? ` · Stol ${escape(order.tableNumber)}` : ''}</div>
  <div class="c">${dateTimeOf(order.createdAt)}</div>
  <hr>
  ${order.customerName || order.customerPhone ? `<div>Mijoz: ${escape(order.customerName ?? '')} ${escape(order.customerPhone ?? '')}</div>` : ''}
  ${address ? `<div>Manzil: ${escape(address)}</div>` : ''}
  ${order.comment ? `<div>Izoh: ${escape(order.comment)}</div>` : ''}
  <hr>
  <table>${lines}</table>
  <hr>
  <table>
    <tr><td>Mahsulotlar</td><td class="r">${som(order.subtotal)}</td></tr>
    ${order.discountTotal ? `<tr><td>Chegirma</td><td class="r">−${som(order.discountTotal)}</td></tr>` : ''}
    ${order.deliveryFee ? `<tr><td>Yetkazish</td><td class="r">${som(order.deliveryFee)}</td></tr>` : ''}
    ${order.serviceFee ? `<tr><td>Xizmat haqi</td><td class="r">${som(order.serviceFee)}</td></tr>` : ''}
    <tr class="tot"><td>JAMI</td><td class="r">${som(order.total)}</td></tr>
  </table>
  <hr>
  <div>Toʻlov: ${escape(order.paymentMethod ? (PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod) : '—')} · ${escape(PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus)}</div>
  <p class="c">Xaridingiz uchun rahmat!</p>
  <script>window.onload = function () { window.print(); setTimeout(function () { window.close(); }, 300); };</script>
</body></html>`);
  win.document.close();
  return true;
}
