import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApiResponse } from '../src/shared/common/interfaces/api-response.interface';
import { createTestApp } from './helpers/test-app.factory';

interface HealthCheckResult {
  status: string;
}

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/v1/health (GET) should return health status', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as ApiResponse<HealthCheckResult>;
        expect(body).toEqual(
          expect.objectContaining({
            success: true,
            path: '/api/v1/health',
          }),
        );
        expect(body.data).toEqual(
          expect.objectContaining({
            status: 'ok',
          }),
        );
      });
  });
});
