import type { Order, RestaurantTable } from '@restor/shared-types';
import { dateTimeOf, som } from './format';
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from './labels';

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The QR image for a table.
 *
 * From a public generator rather than a bundled encoder: it is printed once
 * per table and never rendered at scale, so a dependency would cost more than
 * it returns. The URL it encodes is built server-side, so a printed code
 * cannot point at a stale path.
 */
export function qrImageUrl(data: string, size = 240): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;
}

/**
 * Prints table tents: one card per table with its code, number and zone, on
 * A4. "Save as PDF" in the print dialog is the PDF the floor manager asks for.
 */
export function printQrSheet(tables: RestaurantTable[], restaurantName: string, branchName: string) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return false;

  const cards = tables
    .map(
      (t) => `<div class="card">
  <div class="brand">${escape(restaurantName)}</div>
  <img src="${qrImageUrl(t.qrUrl, 360)}" alt="">
  <div class="num">${escape(t.number)}-stol</div>
  <div class="zone">${escape([t.zone, t.name].filter(Boolean).join(' · '))}</div>
  <div class="hint">Menyuni koʻrish va buyurtma berish uchun skanerlang</div>
</div>`,
    )
    .join('');

  win.document.write(`<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>QR kodlar — ${escape(branchName)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font: 13px/1.35 system-ui, sans-serif; color: #111; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8mm; }
  .card { border: 1px dashed #999; border-radius: 4mm; padding: 5mm; text-align: center; break-inside: avoid; }
  .brand { font-weight: 700; letter-spacing: .5px; margin-bottom: 3mm; }
  img { width: 100%; max-width: 50mm; aspect-ratio: 1; }
  .num { font-size: 20px; font-weight: 800; margin-top: 2mm; }
  .zone { color: #555; min-height: 1.3em; }
  .hint { font-size: 10px; color: #777; margin-top: 2mm; }
</style></head><body>
  <div class="grid">${cards}</div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
  win.document.close();
  return true;
}

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
