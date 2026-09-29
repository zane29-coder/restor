import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './crypto/encryption.service';
import { BranchScope } from './guards/branch-scope.guard';

/**
 * Cross-cutting helpers every feature module needs.
 *
 * Global because the alternative — importing `CommonModule` in twenty feature
 * modules — is noise that hides the imports that actually mean something.
 */
@Global()
@Module({
  providers: [EncryptionService, BranchScope],
  exports: [EncryptionService, BranchScope],
})
export class CommonModule {}
