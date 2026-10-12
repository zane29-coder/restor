import { useQuery } from '@tanstack/react-query';
import { CourierStatus, OrderStatus, Permission } from '@restor/shared-types';
import { api } from './api';
import { useAuth } from './auth';
import { useBranch } from './branch';

/**
 * The handful of live figures the shell shows on every screen: the sidebar
 * badges and the notification bell.
 *
 * One hook per figure, sharing query keys, so the badge and the bell read
 * the same cached answer instead of polling the API twice. Each is gated on
 * the permission its endpoint enforces — a cashier without inventory access
 * would otherwise poll a 403 every 30 seconds.
 */

const POLL_MS = 30_000;

export function useNewOrders() {
  const { can } = useAuth();
  const { branchId } = useBranch();
  return useQuery({
    queryKey: ['live', 'orders', 'new', branchId],
    queryFn: () =>
      api.orders.list({ status: OrderStatus.NEW, branchId: branchId || undefined, limit: 5 }),
    enabled: can(Permission.ORDERS_VIEW),
    refetchInterval: POLL_MS,
  });
}

export function useCouriersOnDelivery() {
  const { can } = useAuth();
  const { branchId } = useBranch();
  return useQuery({
    queryKey: ['live', 'couriers', 'on-delivery', branchId],
    queryFn: () =>
      api.couriers.list({
        status: CourierStatus.ON_DELIVERY,
        branchId: branchId || undefined,
        limit: 1,
      }),
    enabled: can(Permission.COURIERS_VIEW),
    refetchInterval: POLL_MS,
  });
}

export function useStockSummary() {
  const { can } = useAuth();
  const { branchId } = useBranch();
  return useQuery({
    queryKey: ['live', 'stock', 'summary', branchId],
    queryFn: () => api.inventory.summary(branchId || undefined),
    enabled: can(Permission.INVENTORY_VIEW),
    refetchInterval: 120_000,
  });
}

export function usePendingWaiterCalls() {
  const { can } = useAuth();
  const { branchId } = useBranch();
  return useQuery({
    queryKey: ['live', 'waiter-calls', branchId],
    queryFn: () =>
      api.tables.listCalls({ branchId: branchId || undefined, status: 'PENDING' }),
    enabled: can(Permission.WAITER_CALLS_HANDLE),
    refetchInterval: 15_000,
  });
}
