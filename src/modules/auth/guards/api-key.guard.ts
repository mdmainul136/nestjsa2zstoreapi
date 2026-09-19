import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey =
      request.headers['x-api-key'] ||
      request.headers['authorization']?.replace('Bearer ', '');

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('missing x api key');
    }

    const keyHash = crypto
      .createHash('sha256')
      .update(apiKey.trim())
      .digest('hex');

    const keyRecord = await this.prisma.apiKey.findUnique({
      where: { keyHash },
    });

    if (!keyRecord || !keyRecord.isActive) {
      throw new UnauthorizedException('invalid or disabled api key');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('expired api key');
    }
    // লাস্ট ব্যবহারের সময় আপডেট (যদি ফিল্ড থাকে)
    this.prisma.apiKey
      .update({
        where: { id: keyRecord.id },
        data: {
          lastUsedAt: new Date()
        }

      }).catch(err => {
        console.log(err);
      })

    request.apiKey = keyRecord;
    return true;
  }
}
