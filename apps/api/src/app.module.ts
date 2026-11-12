import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountController } from './auth/account.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { DesignsController } from './media/designs.controller';
import { LoyaltyController } from './loyalty/loyalty.controller';
import { StockController } from './stock/stock.controller';
import { WaitlistController } from './waitlist/waitlist.controller';
import { MiniSiteController } from './public/minisite.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { SubscriptionGuard } from './billing/subscription.guard';
import { BotController } from './notify/bot.controller';
import { ClientBotService } from './notify/client-bot.service';
import { MessengersController } from './notify/messengers.controller';
import { BookingsController } from './bookings/bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { CatalogController } from './catalog/catalog.controller';
import { AuthGuard, Public } from './common/auth';
import { PrismaService } from './common/prisma.service';
import { CustomersController } from './customers/customers.controller';
import { PublicController } from './public/public.controller';
import { ResourcesController } from './resources/resources.controller';
import { TenantsController } from './tenants/tenants.controller';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Public()
  @Get()
  async health() {
    await this.prisma.app.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
  ],
  controllers: [WaitlistController, AnalyticsController, DesignsController, LoyaltyController, StockController, MiniSiteController, 
    HealthController, AuthController, TenantsController, ResourcesController, CatalogController,
    CustomersController, BookingsController, PublicController, BillingController, BotController, AccountController, MessengersController,
  ],
  providers: [
    PrismaService,
    AuthService,
    BookingsService,
    BillingService,
    ClientBotService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
})
export class AppModule {}
