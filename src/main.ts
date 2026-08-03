import { LoggerService, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './shared/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './shared/common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = app.get<LoggerService>(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  const port = configService.get<number>('app.port', 3000);
  const apiPrefix = configService.get<string>('app.apiPrefix', 'api/v1');
  const corsEnabled = configService.get<boolean>('cors.enabled', true);
  const corsOrigin = configService.get<string>('cors.origin', '*');

  app.setGlobalPrefix(apiPrefix);

  app.use(helmet());
  app.use(compression());

  if (corsEnabled) {
    app.enableCors({
      origin: corsOrigin === '*' ? true : corsOrigin.split(','),
      credentials: true,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseInterceptor(),
  );

  await app.listen(port);

  logger.log(
    `Application running on port ${port} [${configService.get<string>('app.env')}]`,
    'Bootstrap',
  );
  logger.log(`API prefix: /${apiPrefix}`, 'Bootstrap');
  logger.log(`Health check: /${apiPrefix}/health`, 'Bootstrap');
}

void bootstrap();
