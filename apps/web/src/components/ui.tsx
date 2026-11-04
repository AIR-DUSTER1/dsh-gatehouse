import type { ReactNode } from 'react';
import { Alert, Avatar as AntAvatar, Empty, Flex, Skeleton, Typography, Modal as AntModal } from 'antd';
import type { CaseStatus, RiskLevel, ScheduleStatus, Source } from '@gatehouse/contract';
import { riskLabels, sourceLabels, statusLabels } from '../lib/format';

const { Title, Paragraph, Text } = Typography;

type BadgeTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'signal' | 'ink';

const statusTones: Record<CaseStatus | ScheduleStatus, BadgeTone> = {
  pending_review: 'signal', info_requested: 'warn', approved: 'ink', rejected: 'bad', superseded: 'neutral',
  scheduled: 'ink', paused: 'warn', executing: 'signal', completed: 'ok', failed: 'bad', cancelled: 'neutral',
};
const riskTones: Record<RiskLevel, BadgeTone> = { low: 'neutral', medium: 'warn', high: 'signal', critical: 'bad' };

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: CaseStatus | ScheduleStatus }) {
  return <Badge tone={statusTones[status]}>{statusLabels[status]}</Badge>;
}

export function RiskBadge({ risk }: { risk: RiskLevel; subtle?: boolean }) {
  return <Badge tone={riskTones[risk]}>{riskLabels[risk]}</Badge>;
}

export function SourceBadge({ source }: { source: Source }) {
  return <Badge tone={source === 'feishu' ? 'ink' : source === 'manual' ? 'warn' : 'neutral'}>{sourceLabels[source]}</Badge>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <Flex className="page-header" justify="space-between" align="flex-end" gap={24} wrap>
      <div>
        {eyebrow && <Text className="page-eyebrow">{eyebrow}</Text>}
        <Title level={2}>{title}</Title>
        {description && <Paragraph type="secondary">{description}</Paragraph>}
      </div>
      {actions && <Flex gap={8} wrap>{actions}</Flex>}
    </Flex>
  );
}

export function LoadingState({ label = '正在加载数据…' }: { label?: string }) {
  return (
    <Flex className="state-panel boot-loader" vertical align="center" justify="center" gap={16}>
      <span className="loader-mark" aria-hidden />
      <span className="loader-track" aria-hidden><span className="loader-bar" /></span>
      <Text type="secondary" className="loader-label">{label}</Text>
    </Flex>
  );
}

export function ErrorState({ message, action, onRetry }: { message: string; action?: string | undefined; onRetry?: (() => void) | undefined }) {
  return <Alert type="error" showIcon title={message} description={action} action={onRetry ? <a onClick={onRetry}>重试</a> : undefined} />;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><Text strong>{title}</Text><br /><Text type="secondary">{description}</Text></>}>{action}</Empty>;
}

export function Modal({ open, title, description, onClose, children, footer }: {
  open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return <AntModal open={open} title={title} onCancel={onClose} footer={footer} destroyOnHidden width={620}>
    {description && <Paragraph type="secondary">{description}</Paragraph>}
    {children}
  </AntModal>;
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 26 : size === 'lg' ? 46 : 34;
  return <AntAvatar size={px} className="person-avatar">{name.slice(-2)}</AntAvatar>;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <Flex vertical gap={12} className="skeleton-stack">{Array.from({ length: count }, (_, index) => <Skeleton key={index} active paragraph={{ rows: 1 }} title={false} />)}</Flex>;
}
