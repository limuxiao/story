import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT) || 5178;
  await app.listen(port, '0.0.0.0');

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'studio.db');
  console.log('');
  console.log('  网文写作学习目标管理台 · 后端已启动');
  console.log(`  API     http://localhost:${port}/api`);
  console.log(`  数据库  ${dbPath}`);
  console.log('');
}
bootstrap();
