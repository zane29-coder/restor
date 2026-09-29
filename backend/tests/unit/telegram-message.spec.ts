import {
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  TelegramEvent,
} from '@restor/shared-types';
import {
  buildNewOrderMessage,
  buildPaymentMessage,
  buildStatusMessage,
  buildTestMessage,
} from '../../src/integrations/telegram/message.builder';

const basePayload = {
  tenantId: 't1',
  branchId: 'b1',
  requestId: 'r1',
  actorUserId: null,
  occurredAt: '2026-09-29T09:30:00.000Z',
  orderId: 'o1',
  displayNumber: 'CH-1054',
};

const orderCreated = {
  ...basePayload,
  type: OrderType.DELIVERY,
  source: OrderSource.TELEGRAM_MINI_APP,
  total: 156_000,
  customerName: 'Elbek',
  customerPhone: '+998901234567',
  itemsSummary: [
    { name: 'Chicken Lavash', quantity: 2 },
    { name: 'Fries', quantity: 1 },
  ],
};

/**
 * Telegram messages carry attacker-controlled text: a customer's name, an
 * order comment, a product name an admin typed. HTML parse mode means an
 * unescaped `<` turns the rest of the message into markup — or worse, a
 * working link. These tests exist mainly to keep the escaping honest.
 */
describe('telegram message builder', () => {
  describe('new order', () => {
    it('includes the number, items and total (TZ §16)', () => {
      const message = buildNewOrderMessage(orderCreated, { branchName: 'Chilonzor' });

      expect(message).toContain('CH-1054');
      expect(message).toContain('Chilonzor');
      expect(message).toContain('Chicken Lavash');
      expect(message).toContain('Fries');
      expect(message).toContain('156 000 UZS');
    });

    it('opens with the cart emoji so it is scannable in a busy group', () => {
      expect(buildNewOrderMessage(orderCreated).startsWith('🛒')).toBe(true);
    });

    it('marks each field with a consistent emoji', () => {
      const message = buildNewOrderMessage(orderCreated, {
        branchName: 'Chilonzor',
        address: 'Chilonzor 12',
        comment: 'tez',
      });

      // Same concept, same emoji, every message.
      expect(message).toContain('🏪 <b>Filial:</b>');
      expect(message).toContain('👤 <b>Mijoz:</b>');
      expect(message).toContain('📞 <b>Tel:</b>');
      expect(message).toContain('📍 <b>Manzil:</b>');
      expect(message).toContain('🧾 <b>Tarkibi:</b>');
      expect(message).toContain('💰 <b>JAMI:');
      expect(message).toContain('📝 <b>Izoh:</b>');
    });

    it('picks the emoji for the order type', () => {
      expect(buildNewOrderMessage({ ...orderCreated, type: OrderType.DELIVERY })).toContain('🚚');
      expect(buildNewOrderMessage({ ...orderCreated, type: OrderType.PICKUP })).toContain('🛍');
      expect(buildNewOrderMessage({ ...orderCreated, type: OrderType.DINE_IN })).toContain('🍽');
    });

    it('names the payment method and its status in Uzbek', () => {
      const message = buildNewOrderMessage(orderCreated, {
        paymentLabel: PaymentMethod.CLICK,
        paymentStatus: 'PAID',
      });

      expect(message).toContain('Click');
      expect(message).toContain('Toʻlangan');
      // Not the raw enum value.
      expect(message).not.toContain('PAID');
    });

    it('renders the phone as a tel: link for one-tap calling', () => {
      const message = buildNewOrderMessage(orderCreated);
      expect(message).toContain('<a href="tel:+998901234567">');
      expect(message).toContain('+998 90 123 45 67');
    });

    it('escapes a customer name containing HTML', () => {
      const message = buildNewOrderMessage({
        ...orderCreated,
        customerName: '<b>Vasya</b> & co',
      });

      expect(message).not.toContain('<b>Vasya</b>');
      expect(message).toContain('&lt;b&gt;Vasya&lt;/b&gt; &amp; co');
    });

    it('escapes an order comment containing markup', () => {
      const message = buildNewOrderMessage(orderCreated, {
        comment: 'eshik oldiga qo\'ying <script>alert(1)</script>',
      });

      expect(message).not.toContain('<script>');
      expect(message).toContain('&lt;script&gt;');
    });

    it('escapes a product name containing markup', () => {
      const message = buildNewOrderMessage({
        ...orderCreated,
        itemsSummary: [{ name: 'Burger <img src=x>', quantity: 1 }],
      });

      expect(message).not.toContain('<img');
      expect(message).toContain('&lt;img src=x&gt;');
    });

    it('shows the breakdown only when it differs from the total', () => {
      const withFees = buildNewOrderMessage(orderCreated, {
        subtotal: 141_000,
        deliveryFee: 15_000,
      });
      expect(withFees).toContain('Yetkazish');

      // A pickup order whose subtotal IS the total should not repeat itself.
      const plain = buildNewOrderMessage(orderCreated, { subtotal: 156_000 });
      expect(plain).not.toContain('Mahsulotlar:');
    });

    it('includes the table number for a QR order', () => {
      const message = buildNewOrderMessage(
        { ...orderCreated, type: OrderType.TABLE },
        { tableNumber: '14' },
      );
      expect(message).toContain('Stol');
      expect(message).toContain('14');
    });

    it('omits absent optional fields rather than printing empty labels', () => {
      const message = buildNewOrderMessage({
        ...orderCreated,
        customerName: null,
        customerPhone: null,
      });

      expect(message).not.toContain('Mijoz:');
      expect(message).not.toContain('Tel:');
      expect(message).not.toContain('undefined');
      expect(message).not.toContain('null');
    });
  });

  describe('status change', () => {
    const statusPayload = {
      ...basePayload,
      fromStatus: OrderStatus.NEW,
      toStatus: OrderStatus.ACCEPTED,
      comment: null,
    };

    it('shows the transition in Uzbek', () => {
      const message = buildStatusMessage(statusPayload, { branchName: 'Chilonzor' });
      expect(message).toContain('CH-1054');
      expect(message).toContain('Qabul qilindi');
      expect(message).toContain('Yangi');
    });

    it('leads with a status emoji so the outcome is readable at a glance', () => {
      const cases: Array<[OrderStatus, string]> = [
        [OrderStatus.ACCEPTED, '✅'],
        [OrderStatus.PREPARING, '🍳'],
        [OrderStatus.READY, '🔔'],
        [OrderStatus.COURIER_ASSIGNED, '🛵'],
        [OrderStatus.DELIVERED, '📦'],
        [OrderStatus.CANCELLED, '❌'],
      ];

      for (const [status, emoji] of cases) {
        const message = buildStatusMessage({ ...statusPayload, toStatus: status });
        expect(message.startsWith(emoji)).toBe(true);
      }
    });

    it('escapes a cancellation reason', () => {
      const message = buildStatusMessage({
        ...statusPayload,
        toStatus: OrderStatus.CANCELLED,
        comment: 'mijoz <b>rad etdi</b>',
      });

      expect(message).not.toContain('<b>rad etdi</b>');
      expect(message).toContain('&lt;b&gt;');
    });

    it('handles a first transition with no previous status', () => {
      const message = buildStatusMessage({ ...statusPayload, fromStatus: null });
      expect(message).toContain('CH-1054');
      expect(message).not.toContain('→');
    });
  });

  describe('payment', () => {
    it('distinguishes a full payment from a partial one', () => {
      const payload = {
        ...basePayload,
        paymentId: 'p1',
        method: PaymentMethod.CLICK,
        amount: 156_000,
        isFullyPaid: true,
      };

      expect(buildPaymentMessage(payload)).toContain('Toʻliq toʻlangan');
      expect(buildPaymentMessage({ ...payload, isFullyPaid: false })).toContain('Qisman');
    });

    it('names the payment method', () => {
      const message = buildPaymentMessage({
        ...basePayload,
        paymentId: 'p1',
        method: PaymentMethod.PAYME,
        amount: 50_000,
        isFullyPaid: false,
      });
      expect(message).toContain('Payme');
    });
  });

  it('builds a recognisable test message', () => {
    const message = buildTestMessage(TelegramEvent.NEW_ORDER, 'Chilonzor');
    expect(message).toContain('sinov');
    expect(message).toContain('NEW_ORDER');
    expect(message).toContain('Chilonzor');
  });

  it('never emits a raw angle bracket from user data', () => {
    // One sweep over every builder with hostile input in every slot.
    const hostile = '"><script>x</script>';
    const messages = [
      buildNewOrderMessage(
        { ...orderCreated, customerName: hostile, itemsSummary: [{ name: hostile, quantity: 1 }] },
        { branchName: hostile, address: hostile, comment: hostile, paymentLabel: hostile },
      ),
      buildStatusMessage(
        { ...basePayload, fromStatus: null, toStatus: OrderStatus.READY, comment: hostile },
        { branchName: hostile },
      ),
    ];

    for (const message of messages) {
      expect(message).not.toContain('<script>');
      expect(message).not.toContain('"><');
    }
  });
});
