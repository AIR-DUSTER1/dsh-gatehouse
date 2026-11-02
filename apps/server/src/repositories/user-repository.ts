import type { Role, User } from '@gatehouse/contract';
import type { Database } from '../db/database.js';

type UserRow = { id: string; email: string; name: string; role: Role; password_hash: string; created_at: string };

export interface UserWithPassword extends User { password_hash: string }

export class UserRepository {
  constructor(private readonly db: Database) {}

  create(user: UserWithPassword): void {
    this.db.prepare('INSERT INTO users(id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.name, user.role, user.password_hash, new Date().toISOString());
  }

  findByEmail(email: string): UserWithPassword | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
    return row ? { ...row } : null;
  }

  findById(id: string): User | null {
    const row = this.db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(id) as Omit<UserRow, 'password_hash' | 'created_at'> | undefined;
    return row ? { ...row } : null;
  }

  list(): User[] {
    return this.db.prepare('SELECT id, email, name, role FROM users ORDER BY name').all() as unknown as User[];
  }
}
