import { Link } from 'react-router-dom';
import { Avatar, Button, Card, Col, Empty, Flex, Progress, Row, Space, Statistic, Tag, Timeline, Typography } from 'antd';
import {
  AuditOutlined, CheckCircleOutlined, ClockCircleOutlined, SafetyCertificateOutlined, ThunderboltOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { DashboardResponse, ReviewQueueResponse } from '../../types/api';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { workspacePath } from '../../lib/workspace-routes';
import { useCurrentWorkspace } from '../../router/useCurrentWorkspace';
import { actionLabels, formatDate, relativeTime, riskLabels } from '../../lib/format';
import { ErrorState, LoadingState, PageHeader, RiskBadge, SourceBadge } from '../../components/ui';

const { Text, Title } = Typography;

const riskBarColors: Record<string, string> = { critical: '#c73325', high: '#e8480c', medium: '#b5690a', low: '#191817' };

export function DashboardPage() {
  const { user } = useAuth();
  const { current, currentId } = useCurrentWorkspace();
  const workspaceId = currentId ?? '';
  const { data, loading, error, reload } = useApiData<DashboardResponse>(`/api/dashboard?workspace_id=${encodeURIComponent(workspaceId)}`);
  const { data: queue } = useApiData<ReviewQueueResponse>(`/api/review-cases?workspace_id=${encodeURIComponent(workspaceId)}&status=pending_review&page=1&page_size=4`);
  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error?.message ?? '工作台加载失败'} action={error?.body.error.action} onRetry={reload} />;
  const greeting = new Date().getHours() < 12 ? '早上好' : new Date().getHours() < 18 ? '下午好' : '晚上好';

  const metrics = [
    { label: '等待复核', value: data.pending_review, suffix: '项', icon: <AuditOutlined />, color: '#191817', hint: '建议在 30 分钟内完成首次响应' },
    { label: '高风险需求', value: data.high_risk, suffix: '项', icon: <WarningOutlined />, color: '#e8480c', hint: '重点确认范围、影响与测试计划' },
    { label: '平均复核时长', value: data.average_review_minutes, suffix: '分钟', icon: <ClockCircleOutlined />, color: '#b5690a', hint: `${data.approved_sla_rate}% 在 SLA 内完成` },
    { label: '执行成功率', value: data.execution_success_rate, suffix: '%', icon: <CheckCircleOutlined />, color: '#2c7a4b', hint: '按已完成与失败任务统计' },
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="SEC.01 / WORKSPACE OVERVIEW" title={`${greeting}，${user?.name ?? '复核人'}`} description={`${current?.name ?? '当前工作区'}的待办、风险分布和最近执行动态。`} actions={<Link to={workspacePath(workspaceId, 'review')}><Button type="primary">进入复核中心</Button></Link>} />

      <Row gutter={[12, 12]}>
        {metrics.map((metric, index) => (
          <Col xs={24} sm={12} xl={6} key={metric.label}>
            <Card className="metric-card" variant="borderless">
              <Flex justify="space-between" align="flex-start">
                <div>
                  <Flex align="center" gap={8}><span className="index-no">M.{String(index + 1).padStart(2, '0')}</span><Text type="secondary">{metric.label}</Text></Flex>
                  <Statistic value={metric.value} suffix={metric.suffix} />
                </div>
                <span className="metric-icon" style={{ color: metric.color }}>{metric.icon}</span>
              </Flex>
              <Text type="secondary" className="metric-hint">{metric.hint}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={16}>
          <Card title="优先复核 / QUEUE" extra={<Link to={workspacePath(workspaceId, 'review')}>查看全部</Link>} variant="borderless">
            <Flex vertical gap={10}>
              {queue?.items.length ? queue.items.map((item, index) => (
                <Card key={item.id} size="small" className="queue-item">
                  <Flex align="center" gap={12}>
                    <span className="index-no">Q.{String(index + 1).padStart(2, '0')}</span>
                    <Avatar className="person-avatar">{item.requester.slice(-2)}</Avatar>
                    <div className="focus-copy">
                      <Space wrap size={[8, 4]}><Link to={workspacePath(workspaceId, `review/${item.id}`)}><Text strong>{item.title}</Text></Link><RiskBadge risk={item.risk_level} /><SourceBadge source={item.source} /></Space>
                      <Text type="secondary" ellipsis>{item.latest_proposal_summary}</Text>
                      <Text type="secondary" className="small-text mono-note">{item.requester} · {relativeTime(item.created_at)}</Text>
                    </div>
                    <Link to={workspacePath(workspaceId, `review/${item.id}`)} className="push-right">查看详情</Link>
                  </Flex>
                </Card>
              )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待复核需求" />}
            </Flex>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="风险分布 / RISK" extra={<span className="mono-label">{data.total_cases} 项</span>} variant="borderless" className="full-height-card">
            <Flex vertical gap={18}>
              {(Object.entries(data.risk_distribution) as Array<[keyof typeof data.risk_distribution, number]>).map(([risk, count]) => (
                <div key={risk}>
                  <Flex justify="space-between"><Text>{riskLabels[risk]}</Text><Text strong className="mono-note">{count}</Text></Flex>
                  <Progress percent={Math.round(count / Math.max(1, data.total_cases) * 100)} showInfo={false} size="small" strokeColor={riskBarColors[risk] ?? '#191817'} />
                </div>
              ))}
            </Flex>
            <div className="risk-hint"><SafetyCertificateOutlined /><Text type="secondary">高风险需求需要完整确认影响文件、回滚方案和测试计划。</Text></div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={10}>
          <Card title="规则命中 / RULES" variant="borderless">
            <Flex vertical>
              {data.rule_hits.length ? data.rule_hits.map((item, index) => <Flex key={item.rule} justify="space-between" align="center" className="rule-row"><Space size={10}><span className="index-no">{String(index + 1).padStart(2, '0')}</span><Tag>{item.rule}</Tag></Space><Text strong className="mono-note">{item.count}</Text></Flex>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无规则命中" />}
            </Flex>
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card title="最近动态 / ACTIVITY" extra={<Link to={workspacePath(workspaceId, 'audit')}>审计日志</Link>} variant="borderless">
            <Timeline items={data.recent_activity.map(event => ({
              icon: event.action.includes('finished') ? <CheckCircleOutlined /> : event.action.includes('failed') ? <WarningOutlined /> : <ThunderboltOutlined />,
              content: <Flex justify="space-between" gap={12}><div><Text strong>{actionLabels[event.action] ?? event.action}</Text><br /><Text type="secondary" className="small-text mono-note">{event.actor} · {event.entity_id}</Text></div><Text type="secondary" className="small-text mono-note">{formatDate(event.created_at)}</Text></Flex>,
            }))} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
