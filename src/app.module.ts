import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './modules/mail/mail.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SettingsModule } from './modules/settings/settings.module';
import { CustomerModule } from './modules/customer/customer.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { OperationsModule } from './modules/operations/operations.module';
import { CrmModule } from './modules/crm/crm.module';
import { AiModule } from './modules/ai/ai.module';
import { SearchModule } from './modules/search/search.module';
import { MediaModule } from './modules/media/media.module';
import { CompetitorModule } from './modules/competitor/competitor.module';
import { NbrModule } from './modules/nbr/nbr.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QueueModule } from './modules/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    MailModule,
    PrismaModule,
    CatalogModule,
    PricingModule,
    OrdersModule,
    SettingsModule,
    CustomerModule,
    MarketingModule,
    OperationsModule,
    CrmModule,
    AiModule,
    SearchModule,
    MediaModule,
    CompetitorModule,
    NbrModule,
    PaymentsModule,
    QueueModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}



