import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotificationChannel,
  StockMovementType,
  SupplierOrderStatus,
  type StockItemInsight,
  type StockTake,
  type StockTakeLine,
  type StockUnit,
  type SupplierOrder,
  type SupplierOrderLine,
} from '@restor/shared-types';
import { escapeHtml, startOfDayInZone } from '@restor/shared-utils';
import type {
  CreateSupplierOrderInput,
  ReceiveSupplierOrderInput,
  StockTakeInput,
} from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { InventoryService } from './inventory.service';
import { roundQuantity } from './stock.math';

const UNIT_LABELS: Record<string, string> = { KG: 'kg', G: 'g', L: 'l', ML: 'ml', PCS: 'dona' };

/** `50.000` → `50`, `0.250` → `0,25` — how a person writes it. */
export function formatQuantity(value: string | number, unit: string): string {
  const text = String(Number(value)).replace('.', ',');
  return `${text} ${UNIT_LABELS[unit] ?? unit}`;
}

/**
 * The purchase order as the supplier reads it in Telegram.
 *
 * Quantities only, no prices: what the restaurant expects to pay is its own
 * estimate, and the supplier's invoice is what counts. Every interpolated
 * value is escaped — the message goes out as HTML.
 */
export function buildSupplierOrderMessage(order: {
  number: number;
  restaurantName: string;
  branchName: string;
  branchAddress: string | null;
  branchPhone: string | null;
  lines: Array<{ name: string; unit: string; quantity: string }>;
  note: string | null;
  expectedAt: Date | null;
  timezone: string;
}): string {
  const lines = [
    `🧾 <b>Buyurtma №${order.number}</b> — ${escapeHtml(order.restaurantName)}`,
    `🏪 ${escapeHtml(order.branchName)}${order.branchAddress ? `, ${escapeHtml(order.branchAddress)}` : ''}`,
  ];
  if (order.expectedAt) {
    const when = new Intl.DateTimeFormat('ru-RU', {
      timeZone: order.timezone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(order.expectedAt);
    lines.push(`🚚 Yetkazish: ${when} gacha`);
  }
  lines.push('');
  order.lines.forEach((line, index) => {
    lines.push(`${index + 1}. ${escapeHtml(line.name)} — <b>${escapeHtml(formatQuantity(line.quantity, line.unit))}</b>`);
  });
  if (order.note) lines.push('', `📝 ${escapeHtml(order.note)}`);
  if (order.branchPhone) lines.push('', `📞 ${escapeHtml(order.branchPhone)}`);
  return lines.join('\n');
}

const ORDER_INCLUDE = {
  supplier: { select: { name: true } },
  branch: { select: { name: true, address: true, phone: true, timezone: true } },
  tenant: { select: { name: true } },
  createdBy: { select: { fullName: true } },
} as const;

type OrderRow = Prisma.SupplierOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Buying and counting: purchase orders to suppliers, receiving them into
 * stock, and stock-takes (TZ 29-31).
 *
 * Kept apart from `InventoryService`, which owns the ledger: everything here
 * ends in ordinary movements, written with the same rules — signed
 * quantities, increments in SQL, a reason on every adjustment.
 */
@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchScope: BranchScope,
    private readonly inventory: InventoryService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Item card                                                          */
  /* ------------------------------------------------------------------ */

  /** How fast an item goes, what it goes into, and where it came from. */
  async insight(stockItemId: string): Promise<StockItemInsight> {
    const item = await this.inventory.getItem(stockItemId);
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: item.branchId },
      select: { timezone: true },
    });
    const timezone = branch?.timezone ?? 'Asia/Tashkent';
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

    const now = new Date();
    const from = startOfDayInZone(new Date(now.getTime() - 6 * 86_400_000), timezone);

    const [outflow, ingredients, lastReceipt] = await Promise.all([
      this.prisma.db.stockMovement.findMany({
        where: {
          stockItemId,
          type: { in: [StockMovementType.CONSUMPTION, StockMovementType.WASTE] },
          createdAt: { gte: from },
        },
        select: { type: true, quantity: true, createdAt: true },
      }),
      this.prisma.db.productIngredient.findMany({
        where: { stockItemId, product: { deletedAt: null } },
        select: { quantity: true, product: { select: { id: true, name: true } } },
      }),
      this.prisma.db.stockMovement.findFirst({
        where: { stockItemId, type: StockMovementType.RECEIPT },
        orderBy: { createdAt: 'desc' },
        select: { supplierId: true, costPerUnit: true, createdAt: true, supplier: { select: { name: true } } },
      }),
    ]);

    const days: StockItemInsight['days'] = [];
    for (let i = 0; i < 7; i++) {
      const date = dayKey.format(new Date(from.getTime() + i * 86_400_000 + 12 * 3_600_000));
      const sum = (type: StockMovementType) =>
        roundQuantity(
          outflow
            .filter((m) => m.type === type && dayKey.format(m.createdAt) === date)
            .reduce((total, m) => total + Math.abs(m.quantity.toNumber()), 0),
        );
      days.push({ date, consumed: sum(StockMovementType.CONSUMPTION).toFixed(3), wasted: sum(StockMovementType.WASTE).toFixed(3) });
    }

    const used = days.reduce((total, d) => total + Number(d.consumed) + Number(d.wasted), 0);
    const avgDaily = roundQuantity(used / 7);
    const level = Number(item.quantity);

    return {
      stockItemId,
      days,
      avgDaily: avgDaily.toFixed(3),
      daysLeft: avgDaily > 0 ? Math.max(0, Math.floor(level / avgDaily)) : null,
      products: ingredients.map((row) => ({ id: row.product.id, name: row.product.name, quantity: row.quantity.toFixed(3) })),
      lastReceipt: lastReceipt
        ? {
            supplierId: lastReceipt.supplierId,
            supplierName: lastReceipt.supplier?.name ?? null,
            costPerUnit: lastReceipt.costPerUnit,
            createdAt: lastReceipt.createdAt.toISOString(),
          }
        : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Purchase orders                                                    */
  /* ------------------------------------------------------------------ */

  async listOrders(query: { branchId?: string; status?: SupplierOrderStatus }): Promise<SupplierOrder[]> {
    const rows = await this.prisma.db.supplierOrder.findMany({
      where: {
        branchId: this.branchScope.filterFor(query.branchId),
        ...(query.status ? { status: query.status } : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toOrder);
  }

  /**
   * Creates a purchase order and posts it to the supplier's chat.
   *
   * The order is saved whether or not the message goes out: a supplier with
   * no chat on file still gets the order, by phone, and the saved text is
   * there to copy. The estimate uses each item's last known cost — prices
   * never come from the client.
   */
  async createOrder(input: CreateSupplierOrderInput): Promise<SupplierOrder> {
    this.branchScope.assertCanAccess(input.branchId);
    const ctx = getContext();
    if (!ctx?.tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    const tenantId = ctx.tenantId;

    const supplier = await this.prisma.db.supplier.findFirst({
      where: { id: input.supplierId, deletedAt: null },
    });
    if (!supplier) throw AppException.notFound('Supplier');
    if (!supplier.isActive) throw AppException.badRequest(`"${supplier.name}" faol emas`);

    const items = await this.prisma.db.stockItem.findMany({
      where: { id: { in: input.lines.map((l) => l.stockItemId) }, branchId: input.branchId, deletedAt: null },
      select: { id: true, name: true, unit: true, costPerUnit: true },
    });
    if (items.length !== input.lines.length) {
      throw AppException.badRequest('Mahsulotlardan biri bu filial omborida topilmadi');
    }

    const lines: SupplierOrderLine[] = input.lines.map((line) => {
      const item = items.find((i) => i.id === line.stockItemId)!;
      return {
        stockItemId: item.id,
        name: item.name,
        unit: item.unit as StockUnit,
        quantity: roundQuantity(line.quantity).toFixed(3),
        unitCost: item.costPerUnit,
      };
    });
    const total = lines.reduce((sum, l) => sum + Math.round(Number(l.quantity) * l.unitCost), 0);

    const row = await this.prisma.transaction(async (tx) => {
      // Numbers are per restaurant and quoted to the supplier, so two orders
      // created at once must not both take the same one.
      // `$executeRaw`: the lock function returns void, which `$queryRaw`
      // cannot deserialise.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:supplier_orders`}))`;
      const last = await tx.supplierOrder.aggregate({ _max: { number: true } });
      return tx.supplierOrder.create({
        data: {
          tenantId,
          branchId: input.branchId,
          supplierId: supplier.id,
          number: (last._max.number ?? 0) + 1,
          lines: lines as unknown as Prisma.InputJsonValue,
          total,
          note: input.note || null,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
          createdByUserId: ctx.userId ?? null,
        },
        include: ORDER_INCLUDE,
      });
    });

    const telegramStatus = await this.sendToSupplier(row, supplier.telegramChatId);
    await this.audit.record({
      action: 'SUPPLIER_ORDER_CREATED',
      entity: 'SupplierOrder',
      entityId: row.id,
      newValue: { number: row.number, supplier: supplier.name, lines: lines.length, total, telegramStatus },
    });

    return toOrder({ ...row, telegramStatus });
  }

  /**
   * Books a delivery against an order: one RECEIPT per line actually
   * delivered, in one transaction, each carrying the invoice cost, use-by
   * date and batch code.
   */
  async receiveOrder(id: string, input: ReceiveSupplierOrderInput): Promise<SupplierOrder> {
    const order = await this.requireOrder(id);
    if (order.status !== SupplierOrderStatus.SENT) {
      throw AppException.badRequest('Bu buyurtma allaqachon yopilgan');
    }

    const ordered = new Set((order.lines as unknown as SupplierOrderLine[]).map((l) => l.stockItemId));
    if (input.lines.some((l) => !ordered.has(l.stockItemId))) {
      throw AppException.badRequest('Buyurtmada boʻlmagan mahsulot qabul qilinmaydi');
    }

    const userId = getContext()?.userId ?? null;
    await this.prisma.transaction(async (tx) => {
      for (const line of input.lines) {
        const quantity = roundQuantity(line.quantity);
        await tx.stockMovement.create({
          data: {
            tenantId: order.tenantId,
            stockItemId: line.stockItemId,
            type: StockMovementType.RECEIPT,
            quantity: new Prisma.Decimal(quantity),
            costPerUnit: line.costPerUnit ?? null,
            supplierId: order.supplierId,
            supplierOrderId: order.id,
            expiresAt: line.expiresAt ? new Date(line.expiresAt) : null,
            batchCode: line.batchCode || null,
            comment: `Buyurtma №${order.number}`,
            createdByUserId: userId,
          },
        });
        await tx.stockItem.update({
          where: { id: line.stockItemId },
          data: {
            quantity: { increment: new Prisma.Decimal(quantity) },
            ...(line.costPerUnit ? { costPerUnit: line.costPerUnit } : {}),
          },
        });
      }
      await tx.supplierOrder.update({
        where: { id },
        data: { status: SupplierOrderStatus.RECEIVED, receivedAt: new Date() },
      });
    });

    await this.audit.record({
      action: 'SUPPLIER_ORDER_RECEIVED',
      entity: 'SupplierOrder',
      entityId: id,
      newValue: { number: order.number, lines: input.lines.length },
    });

    return toOrder(await this.requireOrder(id));
  }

  async cancelOrder(id: string): Promise<SupplierOrder> {
    const order = await this.requireOrder(id);
    if (order.status !== SupplierOrderStatus.SENT) {
      throw AppException.badRequest('Bu buyurtma allaqachon yopilgan');
    }
    await this.prisma.db.supplierOrder.update({
      where: { id },
      data: { status: SupplierOrderStatus.CANCELLED, cancelledAt: new Date() },
    });
    await this.audit.record({
      action: 'SUPPLIER_ORDER_CANCELLED',
      entity: 'SupplierOrder',
      entityId: id,
      oldValue: { number: order.number },
    });
    return toOrder(await this.requireOrder(id));
  }

  /** Re-sends an open order, e.g. after the supplier's chat was added. */
  async resendOrder(id: string): Promise<SupplierOrder> {
    const order = await this.requireOrder(id);
    if (order.status !== SupplierOrderStatus.SENT) {
      throw AppException.badRequest('Bu buyurtma allaqachon yopilgan');
    }
    const supplier = await this.prisma.db.supplier.findFirst({
      where: { id: order.supplierId },
      select: { telegramChatId: true },
    });
    const telegramStatus = await this.sendToSupplier(order, supplier?.telegramChatId ?? null);
    if (telegramStatus !== 'QUEUED') {
      throw AppException.badRequest(
        telegramStatus === 'NO_CHAT'
          ? 'Taʼminotchining Telegram chat ID si kiritilmagan'
          : 'Telegram bot sozlanmagan — Telegram boʻlimida bot tokenini kiriting',
      );
    }
    return toOrder(await this.requireOrder(id));
  }

  /* ------------------------------------------------------------------ */
  /* Stock-takes                                                        */
  /* ------------------------------------------------------------------ */

  async listTakes(branchId?: string): Promise<StockTake[]> {
    const rows = await this.prisma.db.stockTake.findMany({
      where: { branchId: this.branchScope.filterFor(branchId) },
      include: { branch: { select: { name: true } }, createdBy: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toTake);
  }

  /**
   * Saves a count and corrects the books to it.
   *
   * The expected figure is read with the rows locked inside the transaction,
   * not taken from the screen: a sale completing while staff were counting
   * would otherwise be overwritten, and the act would show a difference that
   * never existed.
   */
  async createTake(input: StockTakeInput): Promise<StockTake> {
    this.branchScope.assertCanAccess(input.branchId);
    const ctx = getContext();
    if (!ctx?.tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    const tenantId = ctx.tenantId;

    const ids = input.lines.map((l) => l.stockItemId);
    const items = await this.prisma.db.stockItem.findMany({
      where: { id: { in: ids }, branchId: input.branchId, deletedAt: null },
      select: { id: true, name: true, unit: true, costPerUnit: true },
    });
    if (items.length !== ids.length) {
      throw AppException.badRequest('Mahsulotlardan biri bu filial omborida topilmadi');
    }

    const row = await this.prisma.transaction(async (tx) => {
      // Ids were checked against this tenant above; the raw lock only pins them.
      const locked = await tx.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal }>>`
        SELECT "id", "quantity" FROM "stock_items" WHERE "id" = ANY(${ids}::uuid[]) FOR UPDATE
      `;
      const levels = new Map(locked.map((r) => [r.id, Number(r.quantity)]));

      const lines: StockTakeLine[] = [];
      for (const line of input.lines) {
        const item = items.find((i) => i.id === line.stockItemId)!;
        const expected = roundQuantity(levels.get(item.id) ?? 0);
        const counted = roundQuantity(line.counted);
        const difference = roundQuantity(counted - expected);
        lines.push({
          stockItemId: item.id,
          name: item.name,
          unit: item.unit as StockUnit,
          expected: expected.toFixed(3),
          counted: counted.toFixed(3),
          difference: difference.toFixed(3),
          costPerUnit: item.costPerUnit,
          value: Math.round(difference * item.costPerUnit),
        });
        if (difference === 0) continue;

        await tx.stockMovement.create({
          data: {
            tenantId,
            stockItemId: item.id,
            type: StockMovementType.ADJUSTMENT,
            quantity: new Prisma.Decimal(difference),
            comment: `Inventarizatsiya: hisobda ${expected}, sanaldi ${counted}`,
            createdByUserId: ctx.userId ?? null,
          },
        });
        await tx.stockItem.update({
          where: { id: item.id },
          data: { quantity: { increment: new Prisma.Decimal(difference) } },
        });
      }

      return tx.stockTake.create({
        data: {
          tenantId,
          branchId: input.branchId,
          note: input.note || null,
          lines: lines as unknown as Prisma.InputJsonValue,
          itemsCount: lines.length,
          matchedCount: lines.filter((l) => Number(l.difference) === 0).length,
          shortageValue: lines.reduce((sum, l) => sum + (l.value < 0 ? -l.value : 0), 0),
          surplusValue: lines.reduce((sum, l) => sum + (l.value > 0 ? l.value : 0), 0),
          createdByUserId: ctx.userId ?? null,
        },
        include: { branch: { select: { name: true } }, createdBy: { select: { fullName: true } } },
      });
    });

    await this.audit.record({
      action: 'STOCK_TAKE_COMPLETED',
      entity: 'StockTake',
      entityId: row.id,
      newValue: { items: row.itemsCount, matched: row.matchedCount, shortage: row.shortageValue, surplus: row.surplusValue },
    });

    return toTake(row);
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private async requireOrder(id: string) {
    const row = await this.prisma.db.supplierOrder.findFirst({ where: { id }, include: ORDER_INCLUDE });
    if (!row) throw AppException.notFound('SupplierOrder');
    this.branchScope.assertCanAccess(row.branchId);
    return row;
  }

  /**
   * Queues the order message to the supplier's chat through the restaurant's
   * own bot. Never throws: an order that cannot be posted is still an order.
   */
  private async sendToSupplier(order: OrderRow, chatId: string | null): Promise<SupplierOrder['telegramStatus']> {
    let status: SupplierOrder['telegramStatus'] = 'NO_CHAT';
    try {
      if (chatId) {
        const botToken = await this.telegram.resolveBotToken(order.tenantId, order.branchId);
        if (botToken) {
          await this.notifications.dispatch({
            tenantId: order.tenantId,
            channel: NotificationChannel.TELEGRAM,
            recipient: chatId,
            topicId: null,
            text: messageFor(order),
            template: 'supplier.order',
            botToken,
            requestId: getContext()?.requestId ?? null,
            entity: { type: 'SupplierOrder', id: order.id },
          });
          status = 'QUEUED';
        } else {
          status = 'NO_BOT';
        }
      }
      await this.prisma.db.supplierOrder.update({ where: { id: order.id }, data: { telegramStatus: status } });
    } catch (error) {
      this.logger.warn({ orderId: order.id, error: String(error) }, 'Could not post a purchase order to Telegram');
    }
    return status;
  }
}

function messageFor(order: OrderRow): string {
  return buildSupplierOrderMessage({
    number: order.number,
    restaurantName: order.tenant.name,
    branchName: order.branch.name,
    branchAddress: order.branch.address,
    branchPhone: order.branch.phone,
    lines: order.lines as unknown as SupplierOrderLine[],
    note: order.note,
    expectedAt: order.expectedAt,
    timezone: order.branch.timezone,
  });
}

function toOrder(row: OrderRow): SupplierOrder {
  return {
    id: row.id,
    number: row.number,
    branchId: row.branchId,
    branchName: row.branch.name,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    status: row.status as SupplierOrderStatus,
    lines: row.lines as unknown as SupplierOrderLine[],
    total: row.total,
    note: row.note,
    expectedAt: row.expectedAt?.toISOString() ?? null,
    telegramStatus: row.telegramStatus as SupplierOrder['telegramStatus'],
    receivedAt: row.receivedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdByName: row.createdBy?.fullName ?? null,
    messageText: messageFor(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTake(row: {
  id: string;
  branchId: string;
  note: string | null;
  lines: Prisma.JsonValue;
  itemsCount: number;
  matchedCount: number;
  shortageValue: number;
  surplusValue: number;
  createdAt: Date;
  branch: { name: string };
  createdBy: { fullName: string } | null;
}): StockTake {
  return {
    id: row.id,
    branchId: row.branchId,
    branchName: row.branch.name,
    note: row.note,
    lines: row.lines as unknown as StockTakeLine[],
    itemsCount: row.itemsCount,
    matchedCount: row.matchedCount,
    shortageValue: row.shortageValue,
    surplusValue: row.surplusValue,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
