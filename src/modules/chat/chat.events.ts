import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatEvents extends EventEmitter {
  publish(conversationId: string, event: string, data: unknown) {
    this.emit('change', { conversationId, event, data });
  }
}
