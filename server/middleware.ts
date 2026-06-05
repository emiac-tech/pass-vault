import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import type { AuthenticatedRequest, AuthUser, Role, UserStatus } from './types.js';

export function asyncHandler(
  handler: (request: AuthenticatedRequest, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const header = request.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    response.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  let payload: AuthUser;
  try {
    payload = jwt.verify(token, config.jwtSecret) as AuthUser;
  } catch {
    response.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // The JWT is stateless, so re-check the live account on every request. This
  // makes deactivation and role changes take effect immediately instead of
  // lingering until the token expires.
  try {
    const result = await query<{ status: UserStatus; role: Role }>(
      'SELECT status, role FROM users WHERE id = $1',
      [payload.id],
    );
    const account = result.rows[0];
    if (!account) {
      response.status(401).json({ error: 'Account no longer exists' });
      return;
    }
    if (account.status !== 'active') {
      response.status(403).json({ error: 'Account is deactivated' });
      return;
    }
    request.user = { ...payload, role: account.role, status: account.status };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...roles: Role[]) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(request.user.role)) {
      response.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
