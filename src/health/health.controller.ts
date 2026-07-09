import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/api-key.guard';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  liveness() {
    return { status: 'ok' };
  }
}
