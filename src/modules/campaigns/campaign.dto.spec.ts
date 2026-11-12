import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CampaignEvidenceDto, FeaturedBadgesDto, safeEvidenceUrl } from './campaign.dto.js';

describe('Campaign evidence boundary', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>x</script>', 'http://imgur.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://imgur.com.evil.test/a', 'https://user:pass@imgur.com/a', 'https://imgur.com:8443/a', 'https://imgur.com\\@evil.test/a', 'https://imgur.com/\nfoo'])('rejects unsafe URL %s', value => expect(safeEvidenceUrl(value)).toBe(false));
  it.each(['https://imgur.com/a', 'https://drive.google.com/file/d/abc', 'https://youtu.be/abc'])('accepts inert allowlisted link %s', value => expect(safeEvidenceUrl(value)).toBe(true));
  it('accepts exact Vietnamese, emoji and inert script text; rejects malformed Unicode and forged identity', async () => {
    const valid = { submissionKey: '00000000-0000-4000-8000-000000000123', text: 'Tiếng Việt 👩🏽‍💻\r\n<script>alert(1)</script>' };
    expect(await validate(plainToInstance(CampaignEvidenceDto, valid), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    for (const extra of [{ text: '\ud800' }, { text: '\u0000' }, { text: ' ' }, { text: '😀'.repeat(5001) }, { url: null }, { reviewerId: valid.submissionKey }]) expect((await validate(plainToInstance(CampaignEvidenceDto, { ...valid, ...extra }), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
  });
  it('rejects more than three or duplicated featured badge IDs', async () => {
    for (const ids of [Array(4).fill('00000000-0000-4000-8000-000000000123'), ['bad'], null]) expect((await validate(plainToInstance(FeaturedBadgesDto, { ids }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(FeaturedBadgesDto, { ids: [] }))).toEqual([]);
  });
});
