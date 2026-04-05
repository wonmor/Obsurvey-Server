import { Request, Response, NextFunction } from 'express';
import { getSession, UserSession } from './sessionStore';

declare global {
  namespace Express {
    interface Request {
      userSession?: UserSession;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const session = getSession(token);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.userSession = session;
  next();
}
