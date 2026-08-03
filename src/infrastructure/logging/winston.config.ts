import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

export const createWinstonConfig = (
  logLevel: string,
): WinstonModuleOptions => ({
  level: logLevel,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
    }),
  ],
});
