import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerConfig } from './ledger-config.entity';
import { InternalAccount } from './internal-account.entity';
import { LedgerService } from './ledger.service';
import { InternalAccountsService } from './internal-accounts.service';
import { BlnkModule } from '../blnk/blnk.module';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerConfig, InternalAccount]), BlnkModule],
  providers: [LedgerService, InternalAccountsService],
  exports: [LedgerService, InternalAccountsService],
})
export class LedgerModule {}
