import {
    Injectable,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(private reflector?: Reflector) {
        super();
    }

    canActivate(context: ExecutionContext) {

        if (this.reflector) {
            const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
                context.getHandler(),
                context.getClass(),
            ]);
            if (isPublic) {
                return true;
            }
        }

        return super.canActivate(context);
    }


    handleRequest(err: any, user: any, info: any) {
        if (err || !user) {
            if (info?.name === 'TokenExpiredError') {
                throw new UnauthorizedException('Token has expired, please log in again');
            }
            if (info?.name === 'JsonWebTokenError') {
                throw new UnauthorizedException('Invalid or malformed token provided');
            }
            throw err || new UnauthorizedException('Authentication token is missing');
        }

        return user;
    }
}
