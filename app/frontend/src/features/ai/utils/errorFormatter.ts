/* eslint-disable @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition */
interface AiErrorShape {
  response?: { data?: unknown };
  status?: string;
  code?: number;
  message?: string;
  error?: AiErrorShape | string;
  details?: Array<{
    ['@type']?: string;
    retryDelay?: string;
  }>;
}

export const formatAiError = (error: unknown): string => {
  let errorObj: unknown = error;

  // 1. If error is a string, try to parse it as JSON first
  if (typeof error === 'string') {
    try {
      errorObj = JSON.parse(error) as AiErrorShape;
    } catch {
      // If not JSON, it might be a simple error message string
      return error;
    }
  }

  const err = errorObj as AiErrorShape;

  // 2. Extract meaningful data structure
  const errorData: unknown = err.response?.data || err;

  // If errorData is still a string (e.g. nested stringified JSON in response.data), try parse again
  let parsedErrorData: AiErrorShape;
  if (typeof errorData === 'string') {
      try {
        parsedErrorData = JSON.parse(errorData) as AiErrorShape;
      } catch {
        return errorData;
      }
  } else {
    parsedErrorData = errorData as AiErrorShape;
  }

  // 3. Handle Gemini/Google specific format
  const innerError: AiErrorShape | string = (parsedErrorData.error || parsedErrorData) as AiErrorShape | string;

  if (typeof innerError !== 'string') {
    if (innerError.status === 'RESOURCE_EXHAUSTED' || innerError.code === 429) {
      const details = innerError.details || [];
      const retryInfo = details.find((d) => d['@type']?.includes('RetryInfo'));

      let message = "You have exceeded the daily free quota for AI generation.";
      if (retryInfo?.retryDelay) {
        const delay = retryInfo.retryDelay.replace('s', '');
        const seconds = Math.ceil(parseFloat(delay));
        message += ` Please retry in ${seconds} seconds.`;
      } else {
        message += " Please try again later.";
      }
      return message;
    }
  }

  // 4. Handle other common error message fields
  if (typeof innerError === 'string') return innerError;

  if (typeof parsedErrorData.error === 'object' && parsedErrorData.error !== null && 'message' in parsedErrorData.error) {
    return (parsedErrorData.error as AiErrorShape).message || "An unexpected error occurred during AI generation";
  }

  if (parsedErrorData.message) {
    return parsedErrorData.message;
  }

  // 5. Fallback
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred during AI generation";
};
