import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadConfig } from './config/configuration';
import { HealthModule } from './health/health.module';
import { ApiKeyGuard } from './auth/api-key.guard';
import { LedgerModule } from './ledger/ledger.module';
import { CustomersModule } from './customers/customers.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransfersModule } from './transfers/transfers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadConfig()] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('databaseUrl'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    HealthModule,
    LedgerModule,
    CustomersModule,
    AccountsModule,
    TransfersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
