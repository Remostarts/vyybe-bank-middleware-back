import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './account.entity';
import { AccountsService } from './accounts.service';
import { BlnkModule } from '../blnk/blnk.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [TypeOrmModule.forFeature([Account]), BlnkModule, LedgerModule],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
