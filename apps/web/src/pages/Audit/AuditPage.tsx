import { useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Flex, Input, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LockOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { AuditEventRecord } from '@gatehouse/contract';
import type { AuditResponse } from '../../types/api';
import { useApiData } from '../../hooks/useApiData';
import { useCurrentWorkspace } from '../../router/useCurrentWorkspace';
import { actionLabels, formatFullDate } from '../../lib/format';
import { Badge, ErrorState, PageHeader } from '../../components/ui';

const { Text } = Typography;
const actionOptions = [
  { value: 'proposal.created', label: '提案创建' }, { value: 'decision.recorded', label: '人工决策' }, { value: 'schedule.created', label: '排期创建' },
  { value: 'execution.started', label: '执行启动' }, { value: 'execution.dispatched', label: '执行已派发' }, { value: 'execution.finished', label: '执行完成' },
  { value: 'approval.invalidated', label: '批准失效' }, { value: 'plugin.sync.failed', label: '同步失败' },
];

export function AuditPage() {
  const { currentId } = useCurrentWorkspace();
  const workspaceId = currentId ?? '';
  const [action, setAction] = useState<string>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ workspace_id: workspaceId, page: String(page), page_size: '25' });
  if (action) params.set('action', action);
  if (search) params.set('entity_id', search);
  const path = useMemo(() => `/api/audit?${params.toString()}`, [action, search, page, workspaceId]);
  const { data, loading, error, reload } = useApiData<AuditResponse>(path);
  const columns: ColumnsType<AuditEventRecord> = [
    { title: 'NO.', key: 'index', width: 58, render: (_, __, index) => <span className="index-no">{String((page - 1) * 25 + index + 1).padStart(3, '0')}</span> },
    { title: '动作', dataIndex: 'action', width: 170, render: value => <Badge tone={value.includes('failed') || value.includes('expired') ? 'bad' : value.includes('finished') ? 'ok' : 'ink'}>{actionLabels[value] ?? value}</Badge> },
    { title: '实体', dataIndex: 'entity_id', render: (value, event) => <div><Text>{value}</Text><br /><Text type="secondary" className="small-text">{event.entity_type}</Text></div> },
    { title: '操作者', dataIndex: 'actor', width: 130 },
    { title: 'Trace ID', dataIndex: 'trace_id', width: 220, render: value => <Text code ellipsis>{value}</Text> },
    { title: '时间', dataIndex: 'created_at', width: 160, render: value => <Text type="secondary" className="small-text">{formatFullDate(value)}</Text> },
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="SEC.05 / AUDIT TRAIL" title="审计日志" description="记录从 Proposal 接单、人工决策到执行交付的完整事件链。" actions={<Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>} />
      <Alert type="info" showIcon icon={<LockOutlined />} title="Append-only 审计" description="数据库触发器禁止更新和删除审计记录；每条事件保留 trace ID、操作者和前后摘要。" />
      {error && <ErrorState message={error.message} action={error.body.error.action} onRetry={reload} />}
      <Card variant="borderless">
        <Flex justify="space-between" align="center" gap={10} wrap className="table-toolbar">
          <Space wrap>
            <Select allowClear placeholder="全部动作" value={action} options={actionOptions} onChange={value => { setAction(value); setPage(1); }} style={{ width: 150 }} />
            <Input.Search allowClear prefix={<SearchOutlined />} placeholder="按实体 ID 检索" onSearch={value => { setSearch(value.trim()); setPage(1); }} style={{ width: 280 }} />
          </Space>
          <Text type="secondary">共 {data?.total ?? 0} 条事件</Text>
        </Flex>
        <Table<AuditEventRecord>
          rowKey="id" columns={columns} dataSource={data?.items ?? []} loading={loading}
          pagination={{ current: page, pageSize: 25, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
          expandable={{ expandedRowRender: event => <Descriptions size="small" column={1} items={[
            { key: 'trace', label: 'Trace ID', children: <Text code copyable>{event.trace_id}</Text> },
            { key: 'before', label: '变更前', children: <pre className="json-block">{JSON.stringify(event.before, null, 2)}</pre> },
            { key: 'after', label: '变更后', children: <pre className="json-block">{JSON.stringify(event.after, null, 2)}</pre> },
          ]} /> }}
        />
      </Card>
    </div>
  );
}
