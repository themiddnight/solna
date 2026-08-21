export class InvalidAiResponseError extends Error {
  constructor(message: string, public readonly rawResponse?: string) {
    super(message);
    this.name = 'InvalidAiResponseError';
  }
}
