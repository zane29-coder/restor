import {
  CustomerNotificationType,
  NotificationCategory,
  OrderStatus,
  OrderType,
} from '@restor/shared-types';
import {
  notificationTypeForStatus,
  renderOrderNotification,
  renderTelegramText,
} from '../../src/modules/customer-notifications/customer-notification.templates';
import { nextCampaignAllowedAt } from '../../src/modules/marketing/campaign.math';

const order = { displayNumber: 'CH-1054', orderType: OrderType.DELIVERY, total: 156_000 };

describe('notificationTypeForStatus', () => {
  it.each([
    [OrderStatus.ACCEPTED, CustomerNotificationType.ORDER_ACCEPTED],
    [OrderStatus.PREPARING, CustomerNotificationType.ORDER_PREPARING],
    [OrderStatus.READY, CustomerNotificationType.ORDER_READY],
    [OrderStatus.ON_DELIVERY, CustomerNotificationType.ORDER_ON_DELIVERY],
    [OrderStatus.DELIVERED, CustomerNotificationType.ORDER_DELIVERED],
    [OrderStatus.CANCELLED, CustomerNotificationType.ORDER_CANCELLED],
  ])('tells the customer about %s', (status, type) => {
    expect(notificationTypeForStatus(status)).toBe(type);
  });

  it.each([OrderStatus.NEW, OrderStatus.WAITING_COURIER, OrderStatus.COURIER_ASSIGNED, OrderStatus.REFUNDED])(
    'keeps %s to the staff',
    (status) => {
      expect(notificationTypeForStatus(status)).toBeNull();
    },
  );
});

describe('renderOrderNotification', () => {
  it('is transactional, whatever the type — never gated by marketing consent', () => {
    for (const type of Object.values(CustomerNotificationType)) {
      if (['NEW_PRODUCT', 'PROMOTION', 'PROMO_CODE', 'SERVICE'].includes(type)) continue;
      expect(renderOrderNotification(type, order).category).toBe(NotificationCategory.TRANSACTIONAL);
    }
  });

  it('names the order number in the body', () => {
    expect(renderOrderNotification(CustomerNotificationType.ORDER_ACCEPTED, order).body).toContain('CH-1054');
  });

  it('says "ready to collect" for pickup and "handing to courier" for delivery', () => {
    const pickup = renderOrderNotification(CustomerNotificationType.ORDER_READY, {
      ...order,
      orderType: OrderType.PICKUP,
    });
    const delivery = renderOrderNotification(CustomerNotificationType.ORDER_READY, order);
    expect(pickup.body).toContain('olib ketishingiz mumkin');
    expect(delivery.body).toContain('kuryerga');
  });

  it('gives the cancellation reason when there is one', () => {
    const rendered = renderOrderNotification(CustomerNotificationType.ORDER_CANCELLED, {
      ...order,
      cancelReason: 'Mahsulot tugadi',
    });
    expect(rendered.body).toContain('Sabab: Mahsulot tugadi');
  });

  it('formats a paid amount as soʻm, without decimals', () => {
    const rendered = renderOrderNotification(CustomerNotificationType.PAYMENT_RECEIVED, {
      ...order,
      amount: 54_000,
    });
    expect(rendered.body).toMatch(/54\s000 soʻm/);
  });

  it('carries no emoji in the inbox copy — the Mini App draws its own icons', () => {
    for (const type of Object.values(CustomerNotificationType)) {
      const { title, body } = renderOrderNotification(type, order);
      expect(`${title} ${body}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('renderTelegramText', () => {
  const rendered = renderOrderNotification(CustomerNotificationType.ORDER_ACCEPTED, order);

  it('is the same title and body as the inbox, plus the restaurant', () => {
    const text = renderTelegramText(rendered, 'Evos');
    expect(text).toContain(rendered.title);
    expect(text).toContain(rendered.body);
    expect(text).toContain('<i>Evos</i>');
  });

  it('escapes restaurant names and campaign text', () => {
    const text = renderTelegramText(
      { ...rendered, title: '<b>Aksiya</b>', category: NotificationCategory.MARKETING },
      'Tom & Jerry <cafe>',
    );
    expect(text).toContain('&lt;b&gt;Aksiya&lt;/b&gt;');
    expect(text).toContain('Tom &amp; Jerry &lt;cafe&gt;');
  });

  it('tells a marketing recipient how to stop receiving them', () => {
    const text = renderTelegramText({ ...rendered, category: NotificationCategory.MARKETING }, 'Evos');
    expect(text).toContain('Sozlamalar');
  });

  it('adds no unsubscribe line to an order update', () => {
    expect(renderTelegramText(rendered, 'Evos')).not.toContain('Sozlamalar');
  });
});

describe('nextCampaignAllowedAt', () => {
  const now = new Date('2026-10-11T12:00:00Z');

  it('allows a first send', () => {
    expect(nextCampaignAllowedAt(null, now)).toBeNull();
  });

  it('blocks a second send inside the window and says until when', () => {
    const last = new Date('2026-10-11T08:00:00Z');
    expect(nextCampaignAllowedAt(last, now)?.toISOString()).toBe('2026-10-12T08:00:00.000Z');
  });

  it('allows a send once the window has passed', () => {
    expect(nextCampaignAllowedAt(new Date('2026-10-10T11:59:00Z'), now)).toBeNull();
  });
});
