import { Body, Controller, DefaultValuePipe, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { TransfersService } from './transfers.service';
import { CreateDepositDto, CreateTransferDto } from './transfers.dto';
import { IdempotencyService } from '../idempotency/idempotency.service';

@ApiSecurity('x-api-key')
@Controller()
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('transfers')
  @HttpCode(201)
  create(@Body() dto: CreateTransferDto, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, 'POST /v1/transfers', dto, (ctx) => this.transfers.createTransfer(dto, ctx));
  }

  @Post('transfers/:id/commit')
  @HttpCode(200)
  commit(@Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, `POST /v1/transfers/${id}/commit`, { id }, () => this.transfers.commit(id));
  }

  @Post('transfers/:id/void')
  @HttpCode(200)
  void_(@Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, `POST /v1/transfers/${id}/void`, { id }, () => this.transfers.void_(id));
  }

  @Get('transfers/:id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.getById(id);
  }

  @Get('accounts/:id/transactions')
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.transfers.history(id, Math.min(limit, 100), cursor);
  }

  @Post('deposits')
  @HttpCode(201)
  deposit(@Body() dto: CreateDepositDto, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, 'POST /v1/deposits', dto, (ctx) => this.transfers.deposit(dto, ctx));
  }
}
