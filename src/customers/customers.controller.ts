import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { OnboardCustomerDto } from './dto';
import { IdempotencyService } from '../idempotency/idempotency.service';

@ApiSecurity('x-api-key')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly idempotency: IdempotencyService,
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
}
