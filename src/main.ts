import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const fastifyAdapter = new FastifyAdapter({
    rewriteUrl: (req: any) => {
      const url = req.url || '';
      if (
        url &&
        !url.startsWith('/api') &&
        !url.startsWith('/docs') &&
        !url.startsWith('/uploads') &&
        !url.startsWith('/favicon')
      ) {
        return `/api${url}`;
      }
      return url;
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
  );

  // ─── Static Uploads Directory & Multipart Plugin ───
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await app.register(fastifyMultipart as any, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20 MB max file size
    },
  });

  await app.register(fastifyStatic as any, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Auto-rewrite routes missing the /api prefix (supports extension calls like /catalog/extension/sync)
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onRequest', (request: any, reply: any, done: any) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith('/api') &&
      !request.raw.url.startsWith('/docs') &&
      !request.raw.url.startsWith('/uploads') &&
      !request.raw.url.startsWith('/favicon')
    ) {
      request.raw.url = `/api${request.raw.url}`;
    }
    done();
  });

  // API Prefix
  app.setGlobalPrefix('api');

  // CORS
  app.enableCors({
    origin: '*',
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  });

  // Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Swagger কনফিগারেশন
  const swaggerConfig = new DocumentBuilder()
    .setTitle('A2Z Global Cross-Border E-Commerce API')
    .setDescription(
      'Cross-Border E-Commerce, PIM Scraper, 3-Leg Pricing & 12-Stage WMS Engine',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // ✅ Setup Swagger on both /docs and /api/docs
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: false,
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  SwaggerModule.setup('api/docs', app, document, {
    useGlobalPrefix: false,
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = Number(process.env.PORT) || 5001;

  // Fastify এর জন্য host অবশ্যই '0.0.0.0' দিতে হবে
  await app.listen({ port, host: '0.0.0.0' });
  logger.log(`🚀 A2Z Backend API Server is LIVE on: http://localhost:${port}/api`);
  logger.log(`📖 Interactive Swagger Docs: http://localhost:${port}/docs`);
}

void bootstrap();
