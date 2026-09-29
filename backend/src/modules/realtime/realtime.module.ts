import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/** `JwtService` comes from the globally-registered `JwtModule` in AuthModule. */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
