import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'reviewer', 'admin')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_cases (
      id TEXT PRIMARY KEY,
      plugin_case_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      requester TEXT NOT NULL,
      title TEXT NOT NULL,
      requirement_text TEXT NOT NULL,
      requirement_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      source_context TEXT NOT NULL DEFAULT '',
      message_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      review_case_id TEXT NOT NULL REFERENCES review_cases(id),
      assessment_revision INTEGER NOT NULL,
      summary TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      scope_hash TEXT NOT NULL,
      rule_hits_json TEXT NOT NULL,
      impact_files_json TEXT NOT NULL,
      test_plan_json TEXT NOT NULL,
      estimated_cost TEXT NOT NULL,
      risk TEXT NOT NULL,
      risk_reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(review_case_id, assessment_revision)
    );
    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES proposals(id),
      decision TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      comment TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approval_grants (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
      reviewer TEXT NOT NULL,
      requirement_hash TEXT NOT NULL,
      scope_hash TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      schedule_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'revoked', 'expired'))
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
      grant_id TEXT NOT NULL REFERENCES approval_grants(id),
      schedule_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('scheduled', 'paused', 'executing', 'completed', 'failed', 'cancelled')),
      approval_synced_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      execution_id TEXT,
      pr_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id, created_at DESC);
    CREATE TRIGGER IF NOT EXISTS audit_events_no_update
      BEFORE UPDATE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
      BEFORE DELETE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
    CREATE TABLE IF NOT EXISTS plugin_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      nonce TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      received_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox_messages (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'inflight', 'delivered', 'dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox_messages(status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const applied = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  let version = applied.version ?? 0;
  if (version === 0) {
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
    version = 1;
  }
  if (version < 2) migrateWorkspaceV2(db);
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function addColumn(db: Database, table: string, definition: string): void {
  const name = definition.trim().split(/\s+/)[0];
  if (name && !hasColumn(db, table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

/** Schema 2 introduces workspace isolation, repository bindings and versioned routing decisions. */
function migrateWorkspaceV2(db: Database): void {
  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        description_version INTEGER NOT NULL DEFAULT 1,
        description_hash TEXT,
        status TEXT NOT NULL CHECK (status IN ('onboarding', 'active', 'disabled', 'error')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_repositories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        provider TEXT NOT NULL,
        repository_key TEXT NOT NULL,
        api_base_url TEXT,
        web_base_url TEXT NOT NULL,
        clone_url TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        credential_ref TEXT NOT NULL DEFAULT '',
        custom_ca_ref TEXT,
        observe_json TEXT NOT NULL DEFAULT '{"issues":true,"change_requests":true,"comments":true,"ci":true}',
        description TEXT NOT NULL DEFAULT '',
        short_description TEXT NOT NULL DEFAULT '',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        routing_keywords_json TEXT NOT NULL DEFAULT '[]',
        exclusions_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        description_version INTEGER NOT NULL DEFAULT 1,
        description_hash TEXT NOT NULL,
        source_fingerprint TEXT,
        generated_at TEXT,
        confirmed_by TEXT,
        confirmed_at TEXT,
        status TEXT NOT NULL,
        health_state TEXT NOT NULL DEFAULT 'unknown',
        health_detail TEXT NOT NULL DEFAULT '',
        health_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, api_base_url, repository_key)
      );
      CREATE TABLE IF NOT EXISTS workspace_source_bindings (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        repository_id TEXT NOT NULL REFERENCES workspace_repositories(id),
        provider TEXT NOT NULL,
        source_instance_id TEXT NOT NULL UNIQUE,
        config_version INTEGER NOT NULL,
        applied_config_hash TEXT,
        enabled INTEGER NOT NULL,
        last_synced_at TEXT,
        health_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS routing_decisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id),
        repository_id TEXT REFERENCES workspace_repositories(id),
        source TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('explicit', 'native', 'thread', 'semantic', 'manual')),
        confidence REAL,
        reason TEXT NOT NULL,
        candidates_json TEXT NOT NULL,
        requires_human INTEGER NOT NULL,
        overridden_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id, user_id)
      );
    `);

    addColumn(db, 'review_cases', 'workspace_id TEXT REFERENCES workspaces(id)');
    addColumn(db, 'review_cases', 'repository_id TEXT REFERENCES workspace_repositories(id)');
    addColumn(db, 'review_cases', 'routing_decision_id TEXT REFERENCES routing_decisions(id)');
    addColumn(db, 'proposals', 'workspace_id TEXT REFERENCES workspaces(id)');
    addColumn(db, 'proposals', 'repository_id TEXT REFERENCES workspace_repositories(id)');
    addColumn(db, 'proposals', 'workspace_binding_hash TEXT');
    addColumn(db, 'approval_grants', 'workspace_binding_hash TEXT');
    addColumn(db, 'schedules', 'workspace_id TEXT REFERENCES workspaces(id)');
    addColumn(db, 'schedules', 'repository_id TEXT REFERENCES workspace_repositories(id)');
    addColumn(db, 'audit_events', 'workspace_id TEXT REFERENCES workspaces(id)');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_review_cases_workspace_status
        ON review_cases(workspace_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_schedules_workspace_status
        ON schedules(workspace_id, status, schedule_at);
      CREATE INDEX IF NOT EXISTS idx_audit_workspace_created
        ON audit_events(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_routing_workspace_created
        ON routing_decisions(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memberships_user ON workspace_memberships(user_id, workspace_id);
    `);

    const businessRows = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM review_cases) + (SELECT COUNT(*) FROM proposals) +
        (SELECT COUNT(*) FROM schedules) + (SELECT COUNT(*) FROM audit_events) AS count
    `).get() as { count: number };
    const workspaceCount = db.prepare('SELECT COUNT(*) AS count FROM workspaces').get() as { count: number };
    if (businessRows.count > 0 && workspaceCount.count === 0) {
      const at = new Date().toISOString();
      const workspaceId = 'workspace_legacy';
      db.prepare(`
        INSERT INTO workspaces(id, name, slug, description, description_version, description_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, NULL, 'onboarding', ?, ?)
      `).run(workspaceId, '历史数据', 'legacy', '由 v0.1 数据迁移生成，请重命名并绑定实际仓库。', at, at);
      db.prepare('UPDATE review_cases SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
      db.prepare('UPDATE proposals SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
      db.prepare(`
        UPDATE schedules SET workspace_id = COALESCE(
          workspace_id,
          (SELECT p.workspace_id FROM proposals p WHERE p.id = schedules.proposal_id)
        ) WHERE workspace_id IS NULL
      `).run();
      // The append-only triggers guard application writes. Migration performs the single sanctioned backfill,
      // then restores the triggers before the transaction commits.
      db.exec('DROP TRIGGER IF EXISTS audit_events_no_update; DROP TRIGGER IF EXISTS audit_events_no_delete;');
      db.prepare('UPDATE audit_events SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
      db.exec(`
        CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
          BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
        CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
          BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
      `);
      const users = db.prepare('SELECT id FROM users').all() as Array<{ id: string }>;
      const insert = db.prepare('INSERT OR IGNORE INTO workspace_memberships(workspace_id, user_id, created_at) VALUES (?, ?, ?)');
      for (const user of users) insert.run(workspaceId, user.id, at);
    }

    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString());
  });
}

export function transaction<T>(db: Database, callback: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
