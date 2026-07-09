import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './customer.entity';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { BlnkModule } from '../blnk/blnk.module';
import { AccountsModule } from '../accounts/accounts.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';

@Module({
  imports: [TypeOrmModule.forFeature([Customer]), BlnkModule, AccountsModule, IdempotencyModule],
  providers: [CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
