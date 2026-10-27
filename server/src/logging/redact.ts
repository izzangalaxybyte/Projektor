// Keeps credentials out of request logs.
import type { FastifyRequest } from 'fastify';

/**
 * Media URLs carry the session token as ?access_token= (players and <video> cannot send headers),
 * so the default request log wrote live tokens into every log line for a stream or subtitle.
 */
export function redactUrl(url: string): string {
  return url.replace(/([?&]access_token=)[^&#]*/gi, '$1REDACTED');
}

/** Fastify's default request serializer, with the URL redacted. */
export function serializeRequest(req: FastifyRequest) {
  const port = req.socket?.remotePort;
  return {
    method: req.method,
    url: redactUrl(req.url),
    host: req.host,
    remoteAddress: req.ip,
    ...(port === undefined ? {} : { remotePort: port }),
  };
}
