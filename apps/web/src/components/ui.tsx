import type { ReactNode } from 'react';
import { Alert, Avatar as AntAvatar, Empty, Flex, Skeleton, Spin, Tag, Typography, Modal as AntModal } from 'antd';
import type { CaseStatus, RiskLevel, ScheduleStatus } from '@gatehouse/contract';
import { riskLabels, statusLabels } from '../lib/format';

const { Title, Paragraph, Text } = Typography;

const statusColors: Record<CaseStatus | ScheduleStatus, string> = {
  pending_review: 'orange', info_requested: 'gold', approved: 'cyan', rejected: 'red', superseded: 'default',
  scheduled: 'blue', paused: 'gold', executing: 'purple', completed: 'green', failed: 'red', cancelled: 'default',
};
const riskColors: Record<RiskLevel, string> = { low: 'green', medium: 'gold', high: 'orange', critical: 'red' };

export function StatusBadge({ status }: { status: CaseStatus | ScheduleStatus }) {
  return <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>;
}

export function RiskBadge({ risk }: { risk: RiskLevel; subtle?: boolean }) {
  return <Tag color={riskColors[risk]}>{riskLabels[risk]}</Tag>;
}

export function SourceBadge({ source }: { source: 'feishu' | 'github' }) {
  return <Tag color={source === 'feishu' ? 'cyan' : 'default'}>{source === 'feishu' ? '飞书' : 'GitHub'}</Tag>;
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
  return <Flex className="state-panel" vertical align="center" justify="center" gap={12}><Spin size="large" /><Text type="secondary">{label}</Text></Flex>;
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
