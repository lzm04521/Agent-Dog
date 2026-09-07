// AI 网关对外认证：x-api-key 与 Authorization: Bearer 均接受
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { anthropicError } from './anthropic-errors.js';

export function createGatewayAuth(apiKey: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const headerKey = (req.headers['x-api-key'] as string | undefined) || '';
    const authHeader = (req.headers.authorization as string | undefined) || '';
    const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (headerKey === apiKey || (bearerKey && bearerKey === apiKey)) {
      next();
      return;
    }
    anthropicError(res, 401, 'authentication_error', 'invalid x-api-key');
  };
}
