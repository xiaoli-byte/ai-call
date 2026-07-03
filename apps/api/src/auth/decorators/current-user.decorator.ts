import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserProfile } from '@ai-call/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof UserProfile | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: UserProfile }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
