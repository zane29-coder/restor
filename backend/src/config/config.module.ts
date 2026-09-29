import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig } from './configuration';
import { validateEnv } from './env.validation';

/**
 * Configuration, available everywhere.
 *
 * `AppConfig` has to live in its own global module rather than among
 * `AppModule`'s providers: `LoggerModule.forRootAsync` and
 * `ThrottlerModule.forRootAsync` are resolved while `AppModule`'s imports are
 * being built, which is before its own providers exist. A provider declared
 * alongside them is therefore not yet injectable.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Fails fast on a bad value rather than at 3am under load (TZ §54).
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig, ConfigModule],
})
export class AppConfigModule {}
