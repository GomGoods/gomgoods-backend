import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

// Engine.IO handshake origin/rate checks also apply to WebSocket upgrades;
// ordinary HTTP CORS alone does not protect a WebSocket handshake.
export class ChatIoAdapter extends IoAdapter {
  private readonly attempts = new Map<string, number[]>();
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const settings = {
      ...options,
      maxHttpBufferSize: 16 * 1024,
      cors: { origin: this.origins, credentials: true },
      allowRequest: ((request, done) => {
        const now = Date.now();
        for (const [key, values] of this.attempts)
          if (values.at(-1)! <= now - 60_000) this.attempts.delete(key);
        const ip = request.socket.remoteAddress ?? 'unknown';
        const recent = (this.attempts.get(ip) ?? []).filter(
          (t) => t > now - 60_000,
        );
        if (
          !request.headers.origin ||
          !this.origins.includes(request.headers.origin) ||
          recent.length >= 60
        ) {
          done('Connection rejected', false);
          return;
        }
        recent.push(now);
        this.attempts.set(ip, recent);
        done(null, true);
      }) satisfies NonNullable<ServerOptions['allowRequest']>,
    };
    return super.createIOServer(port, settings as ServerOptions);
  }
}
