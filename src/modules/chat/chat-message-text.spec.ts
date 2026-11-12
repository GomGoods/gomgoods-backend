import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { isChatMessageText } from './chat-message-text.js';
import { SendMessageDto, SocketMessageDto } from './chat.dto.js';

describe('Chat Unicode policy: exact text and at most 2000 code points', () => {
  it.each([
    'Xin chào! Mình muốn mua sản phẩm này. Cảm ơn bạn nhé! Đặng Thị Ánh 🌸',
    '👩🏽‍💻 👨‍👩‍👧‍👦 🇻🇳 ❤️ 😀',
    '  Dòng một\nDòng hai\r\n\tGiữ nguyên khoảng trắng!  ',
    'Tiếng Việt: ắ ộ Đ; Ελληνικά; 中文; 日本語; € © ™ <>&\u2028\u2029',
    'Tiếng Việt: ắ ộ Đ'.normalize('NFD'),
  ])('preserves all code points across both DTOs: %s', (content) => {
    for (const type of [SendMessageDto, SocketMessageDto]) {
      const value = plainToInstance(type, {
        clientMessageId: randomUUID(),
        content,
        ...(type === SocketMessageDto ? { conversationId: randomUUID() } : {}),
      });
      expect(
        validateSync(value, { whitelist: true, forbidNonWhitelisted: true }),
      ).toEqual([]);
      expect(value.content).toBe(content);
      expect(isChatMessageText(content)).toBe(true);
    }
  });

  it.each(['ắ', '😀', '❤️', 'a\u0301', '👩🏽‍💻'])(
    'counts scalar values consistently at the exact boundary: %s',
    (unit) => {
      const points = Array.from(unit);
      const content =
        unit.repeat(Math.floor(2000 / points.length)) +
        'đ'.repeat(2000 % points.length);
      expect(Array.from(content)).toHaveLength(2000);
      expect(isChatMessageText(content)).toBe(true);
      expect(isChatMessageText(content + '🌸')).toBe(false);
      expect(
        validateSync(
          plainToInstance(SendMessageDto, {
            clientMessageId: randomUUID(),
            content: content + '🌸',
          }),
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'content' }),
        ]),
      );
    },
  );

  it.each([
    undefined,
    null,
    123,
    '',
    ' \n\r\t',
    '\u0000hello',
    'hello\ud800',
    '\udc00hello',
    '\ud800hello\udc00',
  ])(
    'rejects unsupported/invalid UTF-8 input without repairing it: %j',
    (content) => {
      expect(isChatMessageText(content)).toBe(false);
    },
  );

  it('preserves distinct NFC/NFD forms and does not sanitize literal markup', () => {
    const nfc = 'Cảm ơn!';
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(isChatMessageText(nfc)).toBe(true);
    expect(isChatMessageText(nfd)).toBe(true);
    const content = '<script>alert("chỉ là văn bản 😀")</script>\n<b>đậm</b>';
    const value = plainToInstance(SendMessageDto, {
      clientMessageId: randomUUID(),
      content,
    });
    expect(validateSync(value)).toEqual([]);
    expect(value.content).toBe(content);
  });
});
