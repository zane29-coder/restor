import { ReservationStatus } from '@restor/shared-types';
import { canMoveReservation, slotsOverlap } from '../../src/modules/tables/reservations.service';

const at = (time: string) => new Date(`2026-10-12T${time}:00+05:00`);

describe('slotsOverlap', () => {
  it('flags a booking that starts inside another', () => {
    expect(slotsOverlap({ startsAt: at('19:00'), durationMinutes: 120 }, { startsAt: at('20:30'), durationMinutes: 60 })).toBe(true);
  });

  it('flags a booking that wraps another', () => {
    expect(slotsOverlap({ startsAt: at('18:00'), durationMinutes: 300 }, { startsAt: at('19:00'), durationMinutes: 30 })).toBe(true);
  });

  it('lets one party follow another at the exact minute it leaves', () => {
    expect(slotsOverlap({ startsAt: at('18:00'), durationMinutes: 120 }, { startsAt: at('20:00'), durationMinutes: 90 })).toBe(false);
    expect(slotsOverlap({ startsAt: at('20:00'), durationMinutes: 90 }, { startsAt: at('18:00'), durationMinutes: 120 })).toBe(false);
  });

  it('ignores bookings hours apart', () => {
    expect(slotsOverlap({ startsAt: at('12:00'), durationMinutes: 90 }, { startsAt: at('19:00'), durationMinutes: 120 })).toBe(false);
  });
});

describe('canMoveReservation', () => {
  it('seats, cancels or marks a no-show from a booking', () => {
    expect(canMoveReservation(ReservationStatus.BOOKED, ReservationStatus.SEATED)).toBe(true);
    expect(canMoveReservation(ReservationStatus.BOOKED, ReservationStatus.CANCELLED)).toBe(true);
    expect(canMoveReservation(ReservationStatus.BOOKED, ReservationStatus.NO_SHOW)).toBe(true);
  });

  it('only completes seated guests', () => {
    expect(canMoveReservation(ReservationStatus.SEATED, ReservationStatus.COMPLETED)).toBe(true);
    expect(canMoveReservation(ReservationStatus.SEATED, ReservationStatus.NO_SHOW)).toBe(false);
    expect(canMoveReservation(ReservationStatus.BOOKED, ReservationStatus.COMPLETED)).toBe(false);
  });

  it('never reopens a closed booking', () => {
    for (const closed of [ReservationStatus.COMPLETED, ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW]) {
      expect(canMoveReservation(closed, ReservationStatus.BOOKED)).toBe(false);
      expect(canMoveReservation(closed, ReservationStatus.SEATED)).toBe(false);
    }
  });
});
