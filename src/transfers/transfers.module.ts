import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from './transfer.entity';
import { TierLimit } from './tier-limit.entity';
import { Account } from '../accounts/account.entity';
import { Customer } from '../customers/customer.entity';
import { TransfersService } from './transfers.service';
import { LimitsService } from './limits.service';
import { TransfersController } from './transfers.controller';
import { BlnkModule } from '../blnk/blnk.module';
import { LedgerModule } from '../ledger/ledger.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';

@Module({
  imports: [TypeOrmModule.forFeature([Transfer, TierLimit, Account, Customer]), BlnkModule, LedgerModule, IdempotencyModule],
  providers: [TransfersService, LimitsService],
  controllers: [TransfersController],
})
export class TransfersModule {}
