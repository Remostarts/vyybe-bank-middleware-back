import { Body, Controller, DefaultValuePipe, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { TransfersService } from './transfers.service';
import { CreateDepositDto, CreateTransferDto } from './transfers.dto';
import { IdempotencyService } from '../idempotency/idempotency.service';

@ApiTags('Transfers & Deposits')
@ApiSecurity('x-api-key')
@Controller()
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique key per logical operation (UUIDv4 recommended); reuse the SAME key on retries to resume/replay safely' })
  @Post('transfers')
  @HttpCode(201)
  create(@Body() dto: CreateTransferDto, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, 'POST /v1/transfers', dto, (ctx) => this.transfers.createTransfer(dto, ctx));
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique key per logical operation (UUIDv4 recommended); reuse the SAME key on retries to resume/replay safely' })
  @Post('transfers/:id/commit')
  @HttpCode(200)
  commit(@Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, `POST /v1/transfers/${id}/commit`, { id }, () => this.transfers.commit(id));
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique key per logical operation (UUIDv4 recommended); reuse the SAME key on retries to resume/replay safely' })
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
    return this.transfers.history(id, Math.min(Math.max(limit, 1), 100), cursor);
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique key per logical operation (UUIDv4 recommended); reuse the SAME key on retries to resume/replay safely' })
  @Post('deposits')
  @HttpCode(201)
  deposit(@Body() dto: CreateDepositDto, @Headers('idempotency-key') idemKey?: string) {
    return this.idempotency.execute(idemKey, 'POST /v1/deposits', dto, (ctx) => this.transfers.deposit(dto, ctx));
  }
}
