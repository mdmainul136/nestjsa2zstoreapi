import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const META_ROLES = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(META_ROLES, roles);

