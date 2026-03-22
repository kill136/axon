import type { QuestionOption, UserQuestion } from '../types';

type UserQuestionLike = Partial<UserQuestion> & {
  prompt?: string;
  text?: string;
  message?: string;
  title?: string;
  id?: string;
  questions?: Array<
    Partial<UserQuestion> & {
      id?: string;
      prompt?: string;
      text?: string;
      message?: string;
      title?: string;
    }
  >;
};

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function normalizeOptions(value: unknown): QuestionOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const option = item as Record<string, unknown>;
      const label = typeof option.label === 'string' ? option.label.trim() : '';
      const description = typeof option.description === 'string'
        ? option.description.trim()
        : undefined;

      if (!label) {
        return null;
      }

      return description
        ? { label, description }
        : { label };
    })
    .filter((item): item is QuestionOption => item !== null);

  return options.length > 0 ? options : undefined;
}

export function normalizeUserQuestionPayload(payload: unknown): UserQuestion | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const questionPayload = payload as UserQuestionLike;
  const nestedQuestion = Array.isArray(questionPayload.questions)
    ? questionPayload.questions.find(
        (item): item is NonNullable<UserQuestionLike['questions']>[number] =>
          !!item && typeof item === 'object',
      )
    : undefined;

  const requestId = firstNonEmptyString(
    questionPayload.requestId,
    questionPayload.id,
    nestedQuestion?.requestId,
    nestedQuestion?.id,
  );

  if (!requestId) {
    return null;
  }

  const question = firstNonEmptyString(
    questionPayload.question,
    questionPayload.prompt,
    questionPayload.text,
    questionPayload.message,
    nestedQuestion?.question,
    nestedQuestion?.prompt,
    nestedQuestion?.text,
    nestedQuestion?.message,
  ) || '';

  const header = firstNonEmptyString(
    questionPayload.header,
    questionPayload.title,
    nestedQuestion?.header,
    nestedQuestion?.title,
  );
  const options = normalizeOptions(questionPayload.options ?? nestedQuestion?.options);
  const multiSelect = typeof questionPayload.multiSelect === 'boolean'
    ? questionPayload.multiSelect
    : typeof nestedQuestion?.multiSelect === 'boolean'
      ? nestedQuestion.multiSelect
      : undefined;
  const timeout = typeof questionPayload.timeout === 'number'
    ? questionPayload.timeout
    : typeof nestedQuestion?.timeout === 'number'
      ? nestedQuestion.timeout
      : undefined;

  return {
    requestId,
    question,
    ...(header ? { header } : {}),
    ...(options ? { options } : {}),
    ...(typeof multiSelect === 'boolean' ? { multiSelect } : {}),
    ...(typeof timeout === 'number' ? { timeout } : {}),
  };
}
