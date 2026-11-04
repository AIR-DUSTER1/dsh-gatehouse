import { Link } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Flex, Row, Space, Statistic, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, ExportOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import type { ScheduleResponse } from '../../types/api';
import { useApiData } from '../../hooks/useApiData';
import { useWorkspace, workspacePath } from '../../hooks/useWorkspace';
import { formatFullDate, shortHash } from '../../lib/format';
import { ErrorState, LoadingState, PageHeader, RiskBadge, StatusBadge } from '../../components/ui';

const { Text, Title } = Typography;

export function ExecutionPage() {
  const { currentId } = useWorkspace();
  const workspaceId = currentId ?? '';
  const { data, loading, error, reload } = useApiData<ScheduleResponse>(`/api/schedule?workspace_id=${encodeURIComponent(workspaceId)}`);
  if (loading) return <LoadingState label="正在加载交付记录…" />;
  if (error || !data) return <ErrorState message={error?.message ?? '交付记录加载失败'} action={error?.body.error.action} onRetry={reload} />;
  const records = data.items.filter(item => ['completed', 'failed', 'executing'].includes(item.status));
  const completed = records.filter(item => item.status === 'completed').length;
  const finished = records.filter(item => ['completed', 'failed'].includes(item.status)).length;

  return (
    <div className="page-stack">
      <PageHeader eyebrow="SEC.04 / DELIVERY LOG" title="交付记录" description="查看 dsh-superagent 的 Worker 状态、PR 交付链接与失败信息。" actions={<Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>} />
      <Row gutter={[12, 12]}>
        {[
          { label: '执行成功率', value: finished ? Math.round(completed / finished * 100) : 0, suffix: '%', icon: <CheckCircleOutlined />, color: '#2c7a4b' },
          { label: '已完成交付', value: completed, icon: <CheckCircleOutlined />, color: '#191817' },
          { label: '失败记录', value: records.filter(item => item.status === 'failed').length, icon: <WarningOutlined />, color: '#c73325' },
          { label: '正在执行', value: records.filter(item => item.status === 'executing').length, icon: <ClockCircleOutlined />, color: '#e8480c' },
        ].map((item, index) => <Col xs={12} lg={6} key={item.label}><Card variant="borderless" className="metric-card"><Flex justify="space-between"><div><Flex align="center" gap={8}><span className="index-no">M.{String(index + 1).padStart(2, '0')}</span><Text type="secondary">{item.label}</Text></Flex><Statistic value={item.value} suffix={item.suffix} /></div><span className="metric-icon" style={{ color: item.color }}>{item.icon}</span></Flex></Card></Col>)}
      </Row>
      <Card variant="borderless">
        {records.length ? <Flex vertical gap={10}>{records.map(item => (
          <Card key={item.id} size="small" className="execution-card">
            <Flex gap={14} align="flex-start" wrap>
              {item.status === 'completed' ? <CheckCircleOutlined className="result-icon success" /> : item.status === 'failed' ? <WarningOutlined className="result-icon danger" /> : <ClockCircleOutlined className="result-icon running" />}
              <div className="execution-copy">
                <Space wrap><Link to={workspacePath(workspaceId, `review/${item.review_case_id}`)}><Title level={5}>{item.title}</Title></Link><StatusBadge status={item.status} /><RiskBadge risk={item.risk_level} /></Space>
                <Text type="secondary">{item.proposal_summary}</Text>
                <Space separator="·" wrap><Text type="secondary" className="small-text">Execution {shortHash(item.execution_id ?? '等待分配')}</Text><Text type="secondary" className="small-text">尝试 {item.attempts} / {item.max_attempts}</Text><Text type="secondary" className="small-text">{formatFullDate(item.updated_at)}</Text></Space>
                {item.last_error && <Alert type="error" showIcon title={item.last_error} className="execution-error" />}
              </div>
              <Space className="execution-actions">
                {item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer"><Button icon={<ExportOutlined />}>查看 PR</Button></a>}
                <Link to={workspacePath(workspaceId, `review/${item.review_case_id}`)}>审计详情</Link>
              </Space>
            </Flex>
          </Card>
        ))}</Flex> : <Empty description="还没有执行记录" />}
      </Card>
    </div>
  );
}
