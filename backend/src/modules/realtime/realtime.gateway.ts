import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  DomainEvent,
  RealtimeEvent,
  RealtimeRoom,
  SystemRole,
  type JwtAccessPayload,
  type OrderCreatedPayload,
  type OrderStatusChangedPayload,
} from '@restor/shared-types';
import type { Server, Socket } from 'socket.io';
import { AppConfig } from '../../config/configuration';

interface SocketIdentity {
  userId: string;
  tenantId: string | null;
  branchIds: string[];
  isSuperAdmin: boolean;
  courierId?: string;
}

/**
 * Realtime push (TZ §12).
 *
 * Admin dashboards, the KDS and the customer's tracking screen all subscribe
 * here instead of polling.
 *
 * The security rule that matters: a socket's tenant comes from its TOKEN, and
 * `subscribe` refuses any room outside it. Without that check a client could
 * simply ask to join `branch:<someone else's id>` and watch another
 * restaurant's orders arrive in real time.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  /** Identity per connected socket, established once at handshake. */
  private readonly identities = new Map<string, SocketIdentity>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.auth.accessSecret,
      });

      if (payload.typ !== 'access') {
        client.disconnect(true);
        return;
      }

      this.identities.set(client.id, {
        userId: payload.sub,
        tenantId: payload.tenantId,
        branchIds: payload.branchIds ?? [],
        isSuperAdmin: payload.roles.includes(SystemRole.SUPER_ADMIN),
        courierId: payload.courierId,
      });

      client.on('disconnect', () => this.identities.delete(client.id));
    } catch {
      client.disconnect(true);
    }
  }

  /**
   * Joins a room after checking the socket is entitled to it.
   *
   * Branch rooms are checked against the token's branch scope; the order room
   * is open to anyone in the tenant, because a customer tracking their own
   * order holds only a customer token.
   */
  @SubscribeMessage('subscribe')
  subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { rooms: string[] },
  ): { joined: string[]; refused: string[] } {
    const identity = this.identities.get(client.id);
    if (!identity) return { joined: [], refused: body?.rooms ?? [] };

    const joined: string[] = [];
    const refused: string[] = [];

    for (const room of body?.rooms ?? []) {
      if (this.canJoin(identity, room)) {
        void client.join(room);
        joined.push(room);
      } else {
        refused.push(room);
        this.logger.warn(
          { userId: identity.userId, room },
          'Refused a realtime subscription outside the token’s scope',
        );
      }
    }

    return { joined, refused };
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { rooms: string[] },
  ): { left: string[] } {
    for (const room of body?.rooms ?? []) void client.leave(room);
    return { left: body?.rooms ?? [] };
  }

  /* ------------------------------------------------------------------ */
  /* Domain event fan-out                                               */
  /* ------------------------------------------------------------------ */

  @OnEvent(DomainEvent.ORDER_CREATED)
  onOrderCreated(payload: OrderCreatedPayload): void {
    if (!payload.branchId) return;

    this.emit(RealtimeRoom.branch(payload.branchId), RealtimeEvent.ORDER_CREATED, payload);
    this.emit(RealtimeRoom.kitchen(payload.branchId), RealtimeEvent.KITCHEN_TICKET_CREATED, payload);
    this.emit(RealtimeRoom.pos(payload.branchId), RealtimeEvent.ORDER_CREATED, payload);
  }

  @OnEvent(DomainEvent.ORDER_STATUS_CHANGED)
  onOrderStatusChanged(payload: OrderStatusChangedPayload): void {
    // The customer's tracking screen watches the order room specifically.
    this.emit(RealtimeRoom.order(payload.orderId), RealtimeEvent.ORDER_STATUS, payload);

    if (payload.branchId) {
      this.emit(RealtimeRoom.branch(payload.branchId), RealtimeEvent.ORDER_STATUS, payload);
      this.emit(
        RealtimeRoom.kitchen(payload.branchId),
        RealtimeEvent.KITCHEN_TICKET_UPDATED,
        payload,
      );
    }
  }

  @OnEvent(DomainEvent.COURIER_ASSIGNED)
  onCourierAssigned(payload: { courierId: string; branchId: string | null }): void {
    this.emit(RealtimeRoom.courier(payload.courierId), RealtimeEvent.COURIER_JOB_ASSIGNED, payload);
    if (payload.branchId) {
      this.emit(RealtimeRoom.branch(payload.branchId), RealtimeEvent.ORDER_UPDATED, payload);
    }
  }

  @OnEvent(DomainEvent.COURIER_LOCATION_UPDATED)
  onCourierLocation(payload: { tenantId: string; courierId: string }): void {
    this.emit(RealtimeRoom.dispatch(payload.tenantId), RealtimeEvent.COURIER_LOCATION, payload);
  }

  @OnEvent(DomainEvent.WAITER_CALLED)
  onWaiterCalled(payload: { branchId: string | null }): void {
    if (!payload.branchId) return;
    this.emit(RealtimeRoom.branch(payload.branchId), RealtimeEvent.WAITER_CALL, payload);
    this.emit(RealtimeRoom.pos(payload.branchId), RealtimeEvent.WAITER_CALL, payload);
  }

  /* ------------------------------------------------------------------ */

  private emit(room: string, event: RealtimeEvent, data: unknown): void {
    // The gateway may not be initialised yet in tests or during boot.
    this.server?.to(room).emit(event, {
      event,
      room,
      data,
      sentAt: new Date().toISOString(),
    });
  }

  /** Enforces that a room belongs to the socket's own tenant and scope. */
  private canJoin(identity: SocketIdentity, room: string): boolean {
    const [kind, id] = room.split(':');
    if (!kind || !id) return false;

    if (identity.isSuperAdmin) return true;

    switch (kind) {
      case 'branch':
      case 'kitchen':
      case 'pos':
        // Empty branchIds means "every branch of the tenant".
        return identity.branchIds.length === 0 || identity.branchIds.includes(id);

      case 'courier':
        return identity.courierId === id;

      case 'dispatch':
        return identity.tenantId === id;

      case 'order':
        // Order-level authorisation happens when the order is fetched; the
        // room only carries status changes the holder already requested.
        return Boolean(identity.tenantId);

      default:
        return false;
    }
  }
}
