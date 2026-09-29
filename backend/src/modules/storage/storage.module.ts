import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { StorageController } from './storage.controller';
import { StorageProvider } from './storage.provider';
import { StorageService } from './storage.service';

/**
 * Binds the abstract {@link StorageProvider} to whichever driver
 * `STORAGE_PROVIDER` selects (TZ §39). Consumers inject the abstraction and
 * never learn which one they got.
 */
@Global()
@Module({
  controllers: [StorageController],
  providers: [
    LocalStorageProvider,
    S3StorageProvider,
    {
      provide: StorageProvider,
      inject: [AppConfig, LocalStorageProvider, S3StorageProvider],
      useFactory: (
        config: AppConfig,
        local: LocalStorageProvider,
        s3: S3StorageProvider,
      ): StorageProvider => (config.storage.provider === 'LOCAL' ? local : s3),
    },
    {
      provide: StorageService,
      inject: [StorageProvider, PrismaService, AppConfig],
      useFactory: (provider: StorageProvider, prisma: PrismaService, config: AppConfig) =>
        new StorageService(provider, prisma, config),
    },
  ],
  exports: [StorageService, StorageProvider, LocalStorageProvider],
})
export class StorageModule {}
