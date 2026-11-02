export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly action: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} ${id} 不存在`, '请刷新列表后重试', 404);
  }
}
