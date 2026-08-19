import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HistoricalDataController } from './historical-data.controller';
import { HistoricalDataService } from './historical-data.service';

@Module({
  imports: [AuthModule],
  controllers: [HistoricalDataController],
  providers: [HistoricalDataService],
})
export class HistoricalDataModule {}
