import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { THROTTLE_HISTORICAL } from '../../shared/common/constants/throttle.constants';
import {
  GenerateHistoricalDataDto,
  PreviewHistoricalDataDto,
} from './dto/historical-data.dto';
import { HistoricalDataService } from './historical-data.service';

@Controller('admin')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class HistoricalDataController {
  constructor(private readonly historicalDataService: HistoricalDataService) {}

  @Get('users/:id/historical-data')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.historicalDataService.overview(user, id);
  }

  @Post('users/:id/historical-data/preview')
  @Throttle(THROTTLE_HISTORICAL)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewHistoricalDataDto,
  ) {
    return this.historicalDataService.preview(user, id, dto);
  }

  @Post('users/:id/historical-data/generate')
  @Throttle(THROTTLE_HISTORICAL)
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateHistoricalDataDto,
  ) {
    return this.historicalDataService.generate(user, id, dto);
  }

  @Get('users/:id/historical-data/runs')
  listRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.historicalDataService.listRuns(user, id);
  }

  @Get('historical-data/runs/:runId')
  getRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.historicalDataService.getRun(user, runId);
  }

  @Post('historical-data/runs/:runId/reverse')
  @Throttle(THROTTLE_HISTORICAL)
  reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.historicalDataService.reverse(user, runId);
  }
}
