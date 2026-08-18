import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/test-app.factory';

describe('Catalogue (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated admin product creation', () => {
    return request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .send({ name: 'Tote', brandId: '11111111-1111-4111-8111-111111111111', categoryId: '11111111-1111-4111-8111-111111111111', price: 10 })
      .expect((res) => {
        expect([401, 503]).toContain(res.status);
      });
  });

  it('rejects unauthenticated merchant listing creation', () => {
    return request(app.getHttpServer())
      .post('/api/v1/merchant/listings')
      .send({
        productId: '11111111-1111-4111-8111-111111111111',
        salesPrice: 1000,
      })
      .expect((res) => {
        expect([401, 503]).toContain(res.status);
      });
  });

  it('exposes public catalogue without leaking internals when configured', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/catalogue/products',
    );

    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      const body = response.body as { data: unknown };
      expect(JSON.stringify(body)).not.toContain('wholesale_price');
      expect(JSON.stringify(body)).not.toContain('reserved_quantity');
    }
  });
});
