import { useMemo, useState } from 'react';
import { Button, Card, Flex, Input, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ReviewQueueItem } from '@gatehouse/contract';
import type { ReviewQueueResponse } from '../../types/api';
import { useApiData } from '../../hooks/useApiData';
import { formatDate, sourceLabel } from '../../lib/format';
import { Avatar, ErrorState, PageHeader, RiskBadge, SourceBadge, StatusBadge } from '../../components/ui';

const { Text } = Typography;
const statusTabs = [
  { key: '', label: '全部' }, { key: 'pending_review', label: '待复核' }, { key: 'info_requested', label: '待补充' },
  { key: 'scheduled', label: '已排期' }, { key: 'executing', label: '执行中' }, { key: 'completed', label: '已完成' }, { key: 'failed', label: '失败' },
];

export function ReviewQueuePage() {
  const [status, setStatus] = useState('pending_review');
  const [risk, setRisk] = useState<string>();
  const [source, setSource] = useState<string>();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), page_size: '12' });
  if (status) params.set('status', status);
  if (risk) params.set('risk', risk);
  if (source) params.set('source', source);
  if (search) params.set('search', search);
  const path = useMemo(() => `/api/review-cases?${params.toString()}`, [status, risk, source, search, page]);
  const { data, loading, error, reload } = useApiData<ReviewQueueResponse>(path);

  const columns: ColumnsType<ReviewQueueItem> = [
    { title: 'NO.', key: 'index', width: 58, render: (_, __, index) => <span className="index-no">{String((page - 1) * (data?.page_size ?? 12) + index + 1).padStart(3, '0')}</span> },
    { title: '需求', dataIndex: 'title', width: 360, render: (_, item) => <div className="table-title"><a href={`/review/${item.id}`}>{item.title}</a><Text type="secondary" ellipsis>{item.latest_proposal_summary}</Text></div> },
    { title: '来源', dataIndex: 'source', width: 96, render: value => <SourceBadge source={value} /> },
    { title: '提出人', dataIndex: 'requester', width: 120, render: value => <Space><Avatar name={value} size="sm" /><Text>{value}</Text></Space> },
    { title: '风险', dataIndex: 'risk_level', width: 96, render: value => <RiskBadge risk={value} /> },
    { title: '规则命中', dataIndex: 'rule_hits', width: 200, render: value => <Space size={[4, 4]} wrap>{value.slice(0, 2).map((rule: string) => <Tag key={rule}>{rule}</Tag>)}{value.length > 2 && <Tag>+{value.length - 2}</Tag>}</Space> },
    { title: '状态', dataIndex: 'status', width: 110, render: value => <StatusBadge status={value} /> },
    { title: '创建时间', dataIndex: 'created_at', width: 130, render: value => <Text type="secondary" className="small-text">{formatDate(value)}</Text> },
    { title: '', key: 'actions', width: 80, render: (_, item) => <Button type="link" href={`/review/${item.id}`}>详情</Button> },
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="SEC.02 / REVIEW QUEUE" title="复核中心" description="所有 dsh-superagent 评估完成的 Proposal 在此进入人工决策；批准前不会触发执行。" actions={<Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>} />
      {error && <ErrorState message={error.message} action={error.body.error.action} onRetry={reload} />}
      <Card variant="borderless" className="filter-card">
        <Tabs activeKey={status} items={statusTabs} onChange={key => { setStatus(key); setPage(1); }} />
        <Flex gap={10} wrap>
          <Input.Search allowClear placeholder="搜索标题、提出人或需求内容" prefix={<SearchOutlined />} value={searchInput} onChange={event => setSearchInput(event.target.value)} onSearch={value => { setSearch(value.trim()); setPage(1); }} style={{ width: 340 }} />
          <Select allowClear placeholder="全部风险" value={risk} onChange={value => { setRisk(value); setPage(1); }} style={{ width: 130 }} options={[{ value: 'critical', label: '极高风险' }, { value: 'high', label: '高风险' }, { value: 'medium', label: '中风险' }, { value: 'low', label: '低风险' }]} />
          <Select allowClear placeholder="全部来源" value={source} onChange={value => { setSource(value); setPage(1); }} style={{ width: 130 }} options={[{ value: 'feishu', label: '飞书' }, { value: 'github', label: 'GitHub' }]} />
          <Text type="secondary" className="filter-count">共 {data?.total ?? 0} 条</Text>
        </Flex>
      </Card>
      <Card variant="borderless">
        <Table<ReviewQueueItem>
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={loading}
          scroll={{ x: 1160 }}
          pagination={{ current: page, pageSize: data?.page_size ?? 12, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage, showTotal: total => `共 ${total} 条` }}
          locale={{ emptyText: '暂无符合条件的需求' }}
        />
      </Card>
      <Text type="secondary" className="sr-only">来源：{sourceLabel('feishu')} / {sourceLabel('github')}</Text>
    </div>
  );
}
