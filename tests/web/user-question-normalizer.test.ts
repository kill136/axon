import { describe, expect, it } from 'vitest';
import { normalizeUserQuestionPayload } from '../../src/web/client/src/utils/userQuestion';

describe('normalizeUserQuestionPayload', () => {
  it('should normalize nested AskUserQuestion payloads into a single dialog question', () => {
    const normalized = normalizeUserQuestionPayload({
      requestId: 'req-nested',
      questions: [
        {
          header: 'Framework',
          question: 'Which framework should we use?',
          options: [
            { label: 'React', description: 'Component-based UI' },
            { label: 'Vue', description: 'Progressive framework' },
          ],
          multiSelect: false,
          timeout: 300000,
        },
      ],
    });

    expect(normalized).toEqual({
      requestId: 'req-nested',
      header: 'Framework',
      question: 'Which framework should we use?',
      options: [
        { label: 'React', description: 'Component-based UI' },
        { label: 'Vue', description: 'Progressive framework' },
      ],
      multiSelect: false,
      timeout: 300000,
    });
  });

  it('should fall back to prompt/title/id fields when question/requestId are aliased', () => {
    const normalized = normalizeUserQuestionPayload({
      id: 'req-aliased',
      title: 'Need Info',
      prompt: 'Please confirm the deployment target.',
      options: [
        { label: 'Staging', description: 'Test environment' },
        { label: 'Production', description: 'Live environment' },
      ],
      multiSelect: true,
    });

    expect(normalized).toEqual({
      requestId: 'req-aliased',
      header: 'Need Info',
      question: 'Please confirm the deployment target.',
      options: [
        { label: 'Staging', description: 'Test environment' },
        { label: 'Production', description: 'Live environment' },
      ],
      multiSelect: true,
    });
  });

  it('should return null when a payload has no usable request identifier', () => {
    expect(
      normalizeUserQuestionPayload({
        question: 'Missing request id',
      }),
    ).toBeNull();
  });
});
