import { describe, expect, it } from 'vitest';

import {
  acceptanceReviewMarkInputSchema,
  createAcceptanceReviewMarkSchema,
  updateAcceptanceReviewMarkSchema,
} from './acceptanceReviewRound';

const input = {
  clientId: 'mark-1',
  content: 'The cards are too tight',
  context: {
    commit: 'abc123',
    context: { release: 'preview' },
    env: { consoleErrors: [], userAgent: 'test-agent' },
  },
  kind: 'region' as const,
  pageMeta: { lang: 'en', title: 'Fieldnotes' },
  rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
  rectViewport: { height: 160, width: 384, x: 448, y: 494 },
  regionRefs: [
    {
      box: { height: 160, width: 384, x: 448, y: 494 },
      selector: '#cards',
      text: 'Cards',
    },
  ],
  routeKey: '/notebook',
  scroll: { x: 0, y: 800 },
  targets: [
    {
      label: 'Cards',
      rect: { height: 160, width: 384, x: 448, y: 494 },
      selector: '#cards',
      text: 'Cards',
    },
  ],
  url: 'https://preview.example.com/notebook',
  viewport: { dpr: 2, height: 800, width: 1280 },
};

describe('acceptance review round types', () => {
  it('round-trips the JSON mark payload without changing its typed shape', () => {
    const parsed = acceptanceReviewMarkInputSchema.parse(structuredClone(input));

    expect(parsed).toEqual(input);
    expect(createAcceptanceReviewMarkSchema.parse(parsed)).toEqual(parsed);
  });

  it('rejects malformed page facts and empty updates', () => {
    expect(acceptanceReviewMarkInputSchema.safeParse({ ...input, url: 'not-a-url' }).success).toBe(
      false,
    );
    expect(updateAcceptanceReviewMarkSchema.safeParse({}).success).toBe(false);
  });
});
