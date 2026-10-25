import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import type { Deps } from './deps.js';
const derive = promisify(scrypt);
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}.${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split('.');
  if (!salt || !hex || hex.length !== 128) return false;
  const actual = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
export async function issueSession(d: Deps, req: Request, res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  await d.pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [sha256(token), userId],
  );
  res.cookie('delivery_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: 7 * 86400000,
  });
}
export function sessionToken(req: Request) {
  const value = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('delivery_session='))
    ?.slice('delivery_session='.length);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export async function currentUser(d: Deps, req: Request) {
  const token = sessionToken(req);
  if (!token) return null;
  const result = await d.pool.query(
    'SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()',
    [sha256(token)],
  );
  return result.rows[0] ?? null;
}
export async function allowAuthAttempt(d: Deps, req: Request, email: string) {
  const bucket = Math.floor(Date.now() / 900000);
  const key = sha256(`${req.ip}|${email}|${bucket}`);
  const result = await d.pool.query(
    "INSERT INTO auth_attempts(key,count,expires_at) VALUES($1,1,now()+interval '30 minutes') ON CONFLICT(key) DO UPDATE SET count=auth_attempts.count+1 RETURNING count",
    [key],
  );
  return result.rows[0].count <= 12;
}
