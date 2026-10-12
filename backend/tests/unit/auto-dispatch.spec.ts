import { CourierStatus } from '@restor/shared-types';
import { pickCourier } from '../../src/modules/couriers/couriers.service';

/**
 * Auto-dispatch's choice of courier.
 *
 * A machine giving work to the wrong person is worse than giving it to no
 * one — the order then waits for a dispatcher — so the rule is narrow and
 * tested on its own.
 */

const c = (id: string, status: string, activeDeliveryCount = 0, distanceM?: number) => ({
  id,
  status,
  activeDeliveryCount,
  ...(distanceM !== undefined ? { distanceM } : {}),
});

describe('pickCourier', () => {
  it('never picks a courier who is not AVAILABLE', () => {
    expect(
      pickCourier([c('busy', CourierStatus.ON_DELIVERY, 0, 100), c('break', CourierStatus.BREAK, 0, 50), c('off', CourierStatus.OFFLINE)]),
    ).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickCourier([])).toBeNull();
  });

  it('prefers the least loaded over the nearest', () => {
    const choice = pickCourier([
      c('near-but-loaded', CourierStatus.AVAILABLE, 1, 100),
      c('far-and-idle', CourierStatus.AVAILABLE, 0, 5_000),
    ]);
    expect(choice?.id).toBe('far-and-idle');
  });

  it('breaks a load tie by distance', () => {
    const choice = pickCourier([
      c('far', CourierStatus.AVAILABLE, 0, 3_000),
      c('near', CourierStatus.AVAILABLE, 0, 400),
    ]);
    expect(choice?.id).toBe('near');
  });

  it('puts an unknown position after a known one', () => {
    const choice = pickCourier([c('no-gps', CourierStatus.AVAILABLE, 0), c('gps', CourierStatus.AVAILABLE, 0, 9_000)]);
    expect(choice?.id).toBe('gps');
  });

  it('still picks someone when nobody has a position', () => {
    expect(pickCourier([c('a', CourierStatus.AVAILABLE, 0)])?.id).toBe('a');
  });
});
