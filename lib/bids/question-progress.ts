export type BidQuestionProgress = {
  questionCount: number;
  answeredQuestionCount: number;
  unansweredQuestionCount: number;
};

export function bidQuestionProgress(
  questions: Array<{ responseNotes?: string | null }>,
): BidQuestionProgress {
  const answeredQuestionCount = questions.filter((question) =>
    Boolean(question.responseNotes?.trim())).length;
  return {
    questionCount: questions.length,
    answeredQuestionCount,
    unansweredQuestionCount: Math.max(0, questions.length - answeredQuestionCount),
  };
}
