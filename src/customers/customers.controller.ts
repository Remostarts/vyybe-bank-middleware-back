import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { OnboardCustomerDto, SetKycTierDto } from './customers.dto';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { AccountsService, toAccountDto } from '../accounts/accounts.service';

@ApiSecurity('x-api-key')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly idempotency: IdempotencyService,
    private readonly accounts: AccountsService,
  ) {}

  @Post()
  @HttpCode(201)
  onboard(@Body() dto: OnboardCustomerDto, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, 'POST /v1/customers', dto, () => this.customers.onboard(dto));
  }

  @Get('by-external-id/:externalUserId')
  getByExternalId(@Param('externalUserId') externalUserId: string) {
    return this.customers.getByExternalId(externalUserId);
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.getById(id);
  }

  @Patch(':id/kyc-tier')
  setKycTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetKycTierDto) {
    return this.customers.setKycTier(id, dto.kycTier);
  }

  @Post(':id/accounts')
  @HttpCode(201)
  createAccount(@Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, `POST /v1/customers/${id}/accounts`, { id }, async () => {
      const customer = await this.customers.findEntity(id);
      return toAccountDto(await this.accounts.createAdditionalAccount(customer));
    });
  }
}
