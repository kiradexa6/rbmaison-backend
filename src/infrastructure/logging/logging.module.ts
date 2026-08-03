import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { createWinstonConfig } from './winston.config';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createWinstonConfig(configService.get<string>('logging.level', 'info')),
    }),
  ],
  exports: [WinstonModule],
})
export class LoggingModule {}
