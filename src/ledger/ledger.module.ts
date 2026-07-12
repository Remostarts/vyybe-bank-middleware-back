import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerConfig } from './ledger-config.entity';
import { LedgerService } from './ledger.service';
import { BlnkModule } from '../blnk/blnk.module';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerConfig]), BlnkModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
