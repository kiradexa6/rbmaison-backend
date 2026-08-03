import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/shared/common/filters/all-exceptions.filter';
import { LoggingInterceptor } from '../../src/shared/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '../../src/shared/common/interceptors/response.interceptor';

export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  const configService = app.get(ConfigService);

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

  await app.init();
  return app;
}
