import type { CaseStatus, DecisionType, PermissionCode, RiskLevel, ScheduleStatus, Source, User, UserStatus } from '@gatehouse/contract';

export const statusLabels: Record<CaseStatus | ScheduleStatus, string> = {
  pending_review: '待复核', info_requested: '待补充', approved: '已批准', rejected: '已驳回',
  superseded: '已替代', scheduled: '已排期', paused: '已暂停', executing: '执行中',
  completed: '已完成', failed: '失败', cancelled: '已取消',
};

export const statusExplain: Record<CaseStatus, string> = {
  pending_review: '等待复核人确认范围并作出决策',
  info_requested: '等待需求方补充信息并生成新提案',
  approved: '审批已通过，等待进入排期',
  rejected: '该提案已驳回，不会再执行',
  superseded: '已由新的提案版本替代',
  scheduled: '等待排期时间到达后触发 dsh-superagent',
  executing: 'dsh-superagent 正在执行并准备交付',
  completed: '执行与交付已完成',
  failed: '执行失败，请查看审计与错误详情',
};

export const riskLabels: Record<RiskLevel, string> = { low: '低风险', medium: '中风险', high: '高风险', critical: '极高风险' };
export const permissionLabels: Record<PermissionCode, string> = {
  'workspace.read': '查看工作区', 'workspace.manage': '管理工作区', 'member.manage': '管理工作区成员',
  'repository.manage': '管理仓库', 'review.read': '查看复核', 'review.decide': '执行复核',
  'review.reassign': '改派任务', 'schedule.read': '查看排期', 'schedule.control': '控制排期',
  'execution.read': '查看交付', 'audit.read': '查看审计', 'analytics.global': '查看全局统计',
  'settings.read': '查看设置', 'settings.manage': '管理系统设置', 'user.manage': '管理用户', 'role.manage': '管理角色',
};
export const userStatusLabels: Record<UserStatus, string> = { invited: '等待激活', active: '正常', disabled: '已停用' };
export function hasPermission(user: Pick<User, 'permissions'> | null | undefined, permission: PermissionCode): boolean {
  return Boolean(user && Array.isArray(user.permissions) && user.permissions.includes(permission));
}
export const decisionLabels: Record<DecisionType, string> = { approve: '批准并排期', reject: '驳回', request_info: '要求补充' };

export const actionLabels: Record<string, string> = {
  'proposal.created': '提案已创建', 'proposal.updated': '提案已更新', 'proposal.superseded': '提案已替代',
  'decision.recorded': '审批决策已记录', 'grant.created': '一次性授权已生成', 'schedule.created': '排期已创建',
  'schedule.plugin_synced': '排期已同步至执行器', 'schedule.paused': '排期已暂停', 'schedule.resumed': '排期已恢复',
  'execution.started': '执行已启动', 'execution.dispatched': '执行已派发', 'execution.finished': '执行已完成', 'execution.failed': '执行失败',
  'approval.invalidated': '批准已失效', 'approval.expired': '授权已过期', 'plugin.sync.failed': '执行器同步失败',
  'settings.updated': '系统配置已更新',
  'workspace.created': '工作区已创建', 'workspace.updated': '工作区已更新', 'workspace.disabled': '工作区已停用',
  'repository.created': '仓库已添加', 'repository.validated': '仓库检查完成', 'repository.description_confirmed': '仓库描述已确认',
  'workspaces.synced': '工作区配置已同步', 'routing.reassigned': '工作区已改派',
};

export function formatDate(value: string | null | undefined, withSeconds = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
  }).format(date);
}

export function formatFullDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function shortHash(value: string): string {
  if (value.length < 22) return value;
  return `${value.slice(0, 13)}…${value.slice(-8)}`;
}

export const sourceLabels: Record<Source, string> = {
  feishu: '飞书', github: 'GitHub', gitlab: 'GitLab', gitea: 'Gitea', webhook: 'Webhook', manual: '人工录入',
};
export function sourceLabel(source: Source): string { return sourceLabels[source]; }

