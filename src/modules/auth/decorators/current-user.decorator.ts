import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  isAdmin?: boolean
  role: string;
  avatarUrl?: string
  isVerified: boolean
  isActive: boolean

}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
