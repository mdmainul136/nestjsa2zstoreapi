import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { CatalogController } from './catalog.controller';
import { StorefrontController } from './storefront.controller';
import { SchedulesController } from './schedules.controller';
import { CatalogService } from './catalog.service';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomerModule } from '../customer/customer.module';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';

import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuthModule,
    PricingModule,
    SettingsModule,
    OrdersModule,
    CustomerModule,
    AiModule,
    MediaModule,
  ],
  controllers: [CatalogController, StorefrontController, SchedulesController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
