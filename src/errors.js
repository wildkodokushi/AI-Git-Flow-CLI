/** Error whose message is meant to be shown to the user as is. */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}
