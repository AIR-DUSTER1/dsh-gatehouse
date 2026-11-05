import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';
import { openDatabase, type Database } from './db/database.js';
import { ReviewRepository } from './repositories/review-repository.js';
import { ProposalRepository } from './repositories/proposal-repository.js';
import { DecisionRepository } from './repositories/decision-repository.js';
import { GrantRepository } from './repositories/grant-repository.js';
import { ScheduleRepository } from './repositories/schedule-repository.js';
import { AuditRepository } from './repositories/audit-repository.js';
import { OutboxRepository } from './repositories/outbox-repository.js';
import { PluginEventRepository } from './repositories/plugin-event-repository.js';
import { SettingsRepository } from './repositories/settings-repository.js';
import { UserRepository } from './repositories/user-repository.js';
import { RoleRepository } from './repositories/role-repository.js';
import { UserTokenRepository } from './repositories/user-token-repository.js';
import { AuthEventRepository } from './repositories/auth-event-repository.js';
import { AnalyticsRepository } from './repositories/analytics-repository.js';
import { WorkspaceStore } from './repositories/workspace-repository.js';
import { AuditService } from './audit/audit-service.js';
import { ApprovalService } from './domain/approval-service.js';
import { ReviewQueryService } from './domain/review-query-service.js';
import { PluginEventService } from './domain/plugin-event-service.js';
import { WorkspaceService } from './domain/workspace-service.js';
import { UserService } from './domain/user-service.js';
import { RoleService } from './domain/role-service.js';
import { HttpPluginClient, MockPluginClient, type PluginClient } from './plugin/plugin-client.js';
import { OutboxDispatcher } from './schedule/outbox-dispatcher.js';
import { SchedulerService } from './schedule/scheduler-service.js';
import { ScheduleControlService } from './schedule/schedule-control-service.js';
import { ensureBootstrapAdmin } from './domain/bootstrap-admin.js';
import { DomainError } from './domain/errors.js';
import { registerAuthRoutes } from './api/routes/auth-routes.js';
import { registerReviewRoutes } from './api/routes/review-routes.js';
import { registerScheduleRoutes } from './api/routes/schedule-routes.js';
import { registerAuditRoutes } from './api/routes/audit-routes.js';
import { registerPluginEventRoutes } from './api/routes/plugin-event-routes.js';
import { registerSettingsRoutes } from './api/routes/settings-routes.js';
import { registerWorkspaceRoutes } from './api/routes/workspace-routes.js';
import { registerAnalyticsRoutes } from './api/routes/analytics-routes.js';
import { registerUserRoutes } from './api/routes/user-routes.js';
import { registerRoleRoutes } from './api/routes/role-routes.js';
import { traceId } from './api/request-context.js';

export interface AppContext {
  config: AppConfig;
  db: Database;
  cases: ReviewRepository;
  proposals: ProposalRepository;
  decisions: DecisionRepository;
  grants: GrantRepository;
  schedules: ScheduleRepository;
  auditRepository: AuditRepository;
  outbox: OutboxRepository;
  pluginEvents: PluginEventRepository;
  settings: SettingsRepository;
  users: UserRepository;
  roles: RoleRepository;
  userTokens: UserTokenRepository;
  authEvents: AuthEventRepository;
  userService: UserService;
  roleService: RoleService;
  analytics: AnalyticsRepository;
  workspaceStore: WorkspaceStore;
  workspaceService: WorkspaceService;
  audit: AuditService;
  approval: ApprovalService;
  query: ReviewQueryService;
  eventIngest: PluginEventService;
  plugin: PluginClient;
  dispatcher: OutboxDispatcher;
  scheduler: SchedulerService;
  scheduleControl: ScheduleControlService;
}

export interface Application {
  app: FastifyInstance;
  context: AppContext;
}

export interface CreateApplicationOptions {
  config?: Partial<AppConfig>;
  plugin?: PluginClient;
  logger?: boolean;
  startScheduler?: boolean;
}

export function createContext(config: AppConfig, pluginOverride?: PluginClient): AppContext {
  const db = openDatabase(config.databasePath);
  const cases = new ReviewRepository(db);
  const proposals = new ProposalRepository(db);
  const decisions = new DecisionRepository(db);
  const grants = new GrantRepository(db);
  const schedules = new ScheduleRepository(db);
  const auditRepository = new AuditRepository(db);
  const outbox = new OutboxRepository(db);
  const pluginEvents = new PluginEventRepository(db);
  const settings = new SettingsRepository(db);
  const roles = new RoleRepository(db);
  const users = new UserRepository(db, roles);
  const userTokens = new UserTokenRepository(db);
  const authEvents = new AuthEventRepository(db);
  const analytics = new AnalyticsRepository(db);
  const workspaceStore = new WorkspaceStore(db);
  const audit = new AuditService(auditRepository);
  const plugin = pluginOverride ?? (config.pluginMode === 'http'
    ? new HttpPluginClient(config.pluginBaseUrl, config.pluginSharedSecret, config.pluginTimeoutMs)
    : new MockPluginClient());
  ensureBootstrapAdmin(users, roles, config);
  const workspaceService = new WorkspaceService(db, workspaceStore, plugin, audit, config);
  const userService = new UserService(db, users, roles, userTokens, authEvents, audit, workspaceStore, config);
  const roleService = new RoleService(db, roles, audit);
  const adminUsers = users.list().filter((user) => user.role === 'admin');
  const adminIds = adminUsers.map((user) => user.id);
  for (const workspace of adminUsers[0] ? workspaceStore.list(adminUsers[0]) : []) {
    for (const adminId of adminIds) workspaceStore.addMember(workspace.id, adminId, new Date().toISOString());
  }
  const approval = new ApprovalService(db, cases, proposals, decisions, grants, schedules, outbox, audit,
    config.pluginMaxAttempts, workspaceService);
  const query = new ReviewQueryService(cases, proposals, decisions, grants, schedules, auditRepository, analytics);
  const eventIngest = new PluginEventService(db, pluginEvents, cases, proposals, grants, schedules, audit, workspaceService);
  const dispatcher = new OutboxDispatcher(db, outbox, schedules, grants, proposals, cases, audit, plugin);
  const scheduler = new SchedulerService(db, schedules, grants, proposals, cases, outbox, settings, audit,
    dispatcher, config.schedulePollMs, config.scheduleMaxConcurrency, config.pluginMaxAttempts, workspaceService);
  const scheduleControl = new ScheduleControlService(db, schedules, grants, proposals, cases, outbox, audit,
    config.pluginMaxAttempts, workspaceService);
  return {
    config, db, cases, proposals, decisions, grants, schedules, auditRepository, outbox, pluginEvents,
    settings, users, roles, userTokens, authEvents, userService, roleService, analytics, workspaceStore, workspaceService, audit, approval, query, eventIngest, plugin,
    dispatcher, scheduler, scheduleControl,
  };
}

export async function createApplication(options: CreateApplicationOptions = {}): Promise<Application> {
  const config = loadConfig(options.config);
  const context = createContext(config, options.plugin);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1_048_576 });
  await app.register(cors, { origin: config.webOrigin, credentials: false });

  app.setErrorHandler((error, request, reply) => {
    const trace = traceId(request);
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, action: error.action, trace_id: trace } });
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message, action: '检查请求字段后重试', trace_id: trace } });
    }
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return reply.status(409).send({ error: { code: 'DUPLICATE_RESOURCE', message: '资源已存在或请求已处理', action: '刷新数据后重试', trace_id: trace } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务处理失败', action: '稍后重试并携带 trace_id 查看日志', trace_id: trace } });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'gatehouse', at: new Date().toISOString() }));
  app.get('/ready', async () => {
    context.db.prepare('SELECT 1').get();
    return { status: 'ready', pending_outbox: context.outbox.pendingCount() };
  });

  await registerAuthRoutes(app, context);
  await registerPluginEventRoutes(app, context);
  await registerReviewRoutes(app, context);
  await registerScheduleRoutes(app, context);
  await registerAuditRoutes(app, context);
  await registerSettingsRoutes(app, context);
  await registerWorkspaceRoutes(app, context);
  await registerAnalyticsRoutes(app, context);
  await registerUserRoutes(app, context);
  await registerRoleRoutes(app, context);

  app.addHook('onClose', async () => {
    context.scheduler.stop();
    context.db.close();
  });

  if (options.startScheduler) context.scheduler.start();
  return { app, context };
}
