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
        url !== '/' &&
        !url.startsWith('/health') &&
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

  // ─── Direct Uploads Streamer with Auto-Sync Fallback ───
  const serveUploadWithFallback = async (req: any, reply: any) => {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }

    const localPath = path.join(uploadsDir, filename);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
      };
      reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(fs.createReadStream(localPath));
    }

    // Auto-sync fallback from existing storefront repository if missing on this node
    try {
      const remoteUrl = `https://a2zoutletstore.com/uploads/${encodeURIComponent(filename)}`;
      const remoteRes = await fetch(remoteUrl, { signal: AbortSignal.timeout(3000) });
      if (remoteRes.ok) {
        const buffer = Buffer.from(await remoteRes.arrayBuffer());
        fs.writeFile(localPath, buffer, () => {});
        const contentType = remoteRes.headers.get('content-type') || 'image/jpeg';
        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        return reply.send(buffer);
      }
    } catch (err: any) {
      logger.warn(`Failed to pull remote upload asset: ${filename} - ${err?.message}`);
    }

    return reply.code(404).send({ error: 'File not found' });
  };

  // Direct Healthcheck and Root Endpoints (200 OK for Traefik & Docker)
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.get('/', (_req: any, reply: any) => {
    reply.send({ status: 'ok', service: 'a2z-backend-api', timestamp: new Date().toISOString() });
  });
  fastifyInstance.get('/health', (_req: any, reply: any) => {
    reply.send({ status: 'ok', uptime: process.uptime() });
  });
  fastifyInstance.get('/uploads/:filename', serveUploadWithFallback);
  fastifyInstance.get('/api/uploads/:filename', serveUploadWithFallback);

  // Auto-parse text/plain and raw JSON strings as JSON objects (resilient fallback for clients)
  fastifyInstance.addContentTypeParser(
    ['text/plain', 'application/octet-stream'],
    { parseAs: 'string' },
    (_req: any, body: string, done: any) => {
      try {
        const json = JSON.parse(body);
        done(null, json);
      } catch {
        done(null, body);
      }
    },
  );

  // Auto-rewrite routes missing the /api prefix (supports extension calls like /catalog/extension/sync)
  fastifyInstance.addHook('onRequest', (request: any, reply: any, done: any) => {
    const rawUrl = request.raw.url || '';
    if (
      rawUrl &&
      rawUrl !== '/' &&
      !rawUrl.startsWith('/health') &&
      !rawUrl.startsWith('/api') &&
      !rawUrl.startsWith('/docs') &&
      !rawUrl.startsWith('/uploads') &&
      !rawUrl.startsWith('/favicon')
    ) {
      request.raw.url = `/api${rawUrl}`;
    }
    done();
  });

  // Security Headers Hook (Protection against XSS, Clickjacking, MIME-sniffing, Information Leakage)
  fastifyInstance.addHook('onSend', async (_request: any, reply: any) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.removeHeader('x-powered-by');
  });

  // API Prefix
  app.setGlobalPrefix('api');

  // Hardened Domain-Restricted CORS
  const allowedOriginsStr = process.env.ALLOWED_ORIGINS || '';
  const allowedOrigins = allowedOriginsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin.endsWith('.a2zoutletstore.com') ||
        origin === 'https://a2zoutletstore.com' ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} blocked by CORS security policy`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Requested-With', 'Accept'],
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
