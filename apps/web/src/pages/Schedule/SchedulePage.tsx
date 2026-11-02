import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App as AntdApp, Button, Card, Col, Empty, Flex, Popconfirm, Row, Space, Statistic, Tag, Typography } from 'antd';
import type { ScheduleListItem } from '@gatehouse/contract';
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { api, ApiError } from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { formatFullDate } from '../../lib/format';
import type { ScheduleActionResponse, ScheduleResponse } from '../../types/api';
import { ErrorState, LoadingState, PageHeader, RiskBadge, StatusBadge } from '../../components/ui';

const { Text, Title } = Typography;
const groups = [
  { key: 'scheduled', title: '待执行', hint: '按计划时间触发 dsh-superagent', statuses: ['scheduled', 'paused'] },
  { key: 'executing', title: '执行中', hint: 'Worker 正在执行或等待回执', statuses: ['executing'] },
  { key: 'completed', title: '已完成', hint: '交付结果已经回写', statuses: ['completed'] },
  { key: 'failed', title: '异常', hint: '需要人工检查失败原因', statuses: ['failed', 'cancelled'] },
];

export function SchedulePage() {
  const { user } = useAuth();
  const { message } = AntdApp.useApp();
  const { data, loading, error, reload } = useApiData<ScheduleResponse>('/api/schedule');
  const [pendingId, setPendingId] = useState('');
  const canControl = user?.role === 'reviewer' || user?.role === 'admin';
  if (loading) return <LoadingState label="正在读取持久化排期…" />;
  if (error || !data) return <ErrorState message={error?.message ?? '排期加载失败'} action={error?.body.error.action} onRetry={reload} />;

  const act = async (item: ScheduleListItem, action: 'pause' | 'resume') => {
    setPendingId(item.id);
    try {
      await api<ScheduleActionResponse>(`/api/schedule/${item.id}/${action}`, { method: 'POST' });
      message.success(action === 'pause' ? '排期已暂停' : '排期已恢复');
      reload();
    } catch (reason) {
      message.error(reason instanceof ApiError ? reason.body.error.message : '操作失败');
    } finally { setPendingId(''); }
  };

  return (
    <div className="page-stack">
      <PageHeader title="执行调度" description="排期持久化在 SQLite 中，到期后由控制台调用 dsh-superagent 执行。" actions={<Button icon={<ReloadOutlined />} onClick={reload}>刷新状态</Button>} />
      <Row gutter={[12, 12]}>
        {[
          { label: '当前执行数', value: `${data.metrics.executing} / ${data.metrics.max_concurrency}`, icon: <ClockCircleOutlined />, color: '#722ed1' },
          { label: '今日待执行', value: data.metrics.due_today, icon: <CalendarOutlined />, color: '#1677ff' },
          { label: '已超时', value: data.metrics.overdue, icon: <WarningOutlined />, color: '#d46b08' },
          { label: '阻塞任务', value: data.metrics.blocked, icon: <WarningOutlined />, color: '#cf1322' },
        ].map(item => <Col xs={12} lg={6} key={item.label}><Card variant="borderless" className="metric-card"><Flex justify="space-between"><div><Text type="secondary">{item.label}</Text><Statistic value={item.value} /></div><span className="metric-icon" style={{ color: item.color, background: `${item.color}12` }}>{item.icon}</span></Flex></Card></Col>)}
      </Row>
      <div className="schedule-grid">
        {groups.map(group => {
          const items = data.items.filter(item => group.statuses.includes(item.status));
          return <Card key={group.key} title={<Space><CheckCircleOutlined />{group.title}<Tag>{items.length}</Tag></Space>} extra={<Text type="secondary" className="small-text">{group.hint}</Text>} variant="borderless" className="schedule-column">
            {items.length ? <Flex vertical gap={10}>{items.map(item => <Card key={item.id} size="small" className="schedule-item">
              <Flex justify="space-between" align="flex-start" gap={8}><Link to={`/review/${item.review_case_id}`}><Title level={5}>{item.title}</Title></Link><RiskBadge risk={item.risk_level} /></Flex>
              <Text type="secondary" className="schedule-summary">{item.proposal_summary}</Text>
              <Space className="schedule-meta"><StatusBadge status={item.status} /><Text type="secondary" className="small-text">{formatFullDate(item.schedule_at)}</Text></Space>
              {item.last_error && <Text type="danger" className="small-text">{item.last_error}</Text>}
              {item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer">查看 Pull Request</a>}
              {canControl && ['scheduled', 'paused'].includes(item.status) && <Popconfirm title={item.status === 'paused' ? '恢复此排期？' : '暂停此排期？'} onConfirm={() => void act(item, item.status === 'paused' ? 'resume' : 'pause')}><Button size="small" loading={pendingId === item.id}>{item.status === 'paused' ? '恢复排期' : '暂停排期'}</Button></Popconfirm>}
            </Card>)}</Flex> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />}
          </Card>;
        })}
      </div>
    </div>
  );
}
