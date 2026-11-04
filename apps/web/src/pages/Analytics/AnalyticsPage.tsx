import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Flex, Progress, Row, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import {
  ApartmentOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, ReloadOutlined,
  SafetyCertificateOutlined, ThunderboltOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { AnalyticsOverview, AnalyticsWorkspaceRow } from '@gatehouse/contract';
import { useApiData } from '../../hooks/useApiData';
import { formatFullDate } from '../../lib/format';
import { workspacePath } from '../../hooks/useWorkspace';
import { ErrorState, LoadingState, PageHeader } from '../../components/ui';

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const { Text } = Typography;

const rangeLabels = { '7d': '近 7 天', '30d': '近 30 天', '90d': '近 90 天' } as const;
type AnalyticsRange = keyof typeof rangeLabels;

function TrendChart({ points }: { points: AnalyticsOverview['trend'] }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const option = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 420,
    color: ['#191817', '#2c7a4b', '#c73325'],
    grid: { left: 18, right: 24, top: 28, bottom: 56, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#141311',
      borderColor: '#141311',
      padding: [8, 10],
      textStyle: { color: '#f2f1ec', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      axisPointer: { type: 'line', lineStyle: { color: '#a39e93', type: 'dashed' } },
    },
    legend: {
      left: 0,
      bottom: 0,
      itemWidth: 16,
      itemHeight: 2,
      itemGap: 18,
      icon: 'rect',
      textStyle: { color: '#6b675e', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 },
      data: ['新建', '完成', '失败'],
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map(point => point.date.slice(5)),
      axisLine: { lineStyle: { color: '#ddd9cf' } },
      axisTick: { show: false },
      axisLabel: { color: '#a39e93', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#a39e93', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 },
      splitLine: { lineStyle: { color: '#e8e5dd', type: 'dashed' } },
    },
    series: [
      { name: '新建', type: 'line', data: points.map(point => point.created), showSymbol: false, symbolSize: 6,
        lineStyle: { width: 2.2 }, emphasis: { focus: 'series' } },
      { name: '完成', type: 'line', data: points.map(point => point.completed), showSymbol: false, symbolSize: 6,
        lineStyle: { width: 2.2 }, emphasis: { focus: 'series' } },
      { name: '失败', type: 'line', data: points.map(point => point.failed), showSymbol: false, symbolSize: 6,
        lineStyle: { width: 2.2 }, emphasis: { focus: 'series' } },
    ],
  }), [points]);

  useEffect(() => {
    if (!container.current) return;
    const instance = echarts.init(container.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={container} className="echarts-chart" role="img" aria-label="任务新建、完成与失败趋势图" />;
}

function Distribution({ title, items }: { title: string; items: Array<{ label: string; value: number }> }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0));
  return <Card title={title} variant="borderless">
    {items.length ? <Flex vertical gap={14}>{items.map(item => <div key={item.label}>
      <Flex justify="space-between"><Text>{item.label}</Text><Text strong className="mono-note">{item.value}</Text></Flex>
      <Progress percent={Math.round(item.value / total * 100)} showInfo={false} size="small" strokeColor="#191817" />
    </div>)}</Flex> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围暂无数据" />}
  </Card>;
}

export function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const { data, loading, error, reload } = useApiData<AnalyticsOverview>(`/api/analytics/overview?range=${range}`);
  const columns: ColumnsType<AnalyticsWorkspaceRow> = [
    { title: '工作区', dataIndex: 'workspace_name', width: 180, render: (value, row) => <div><Link to={workspacePath(row.workspace_id)}><Text strong>{value}</Text></Link><br /><Text type="secondary" className="small-text">{row.workspace_slug}</Text></div> },
    { title: '仓库 / Provider', dataIndex: 'repositories', width: 250, render: (repositories: AnalyticsWorkspaceRow['repositories']) => repositories.length ? <Space wrap>{repositories.map(repo => <Tag key={repo.id}>{repo.provider} · {repo.repository_key}</Tag>)}</Space> : <Text type="secondary">未绑定</Text> },
    { title: '待复核', dataIndex: 'pending_review', width: 86 },
    { title: '已排期', dataIndex: 'scheduled', width: 86 },
    { title: '执行中', dataIndex: 'executing', width: 86 },
    { title: '失败', dataIndex: 'failed', width: 76, render: value => <Text type={value ? 'danger' : 'secondary'}>{value}</Text> },
    { title: '完成率', dataIndex: 'completion_rate', width: 90, render: value => `${value}%` },
    { title: '平均复核', dataIndex: 'average_review_minutes', width: 100, render: value => `${value} 分` },
    { title: '最近活动', dataIndex: 'last_activity_at', width: 150, render: value => <Text type="secondary" className="small-text">{formatFullDate(value)}</Text> },
  ];
  const providerItems = useMemo(() => data?.provider_distribution.map(item => ({ label: item.provider, value: item.count })) ?? [], [data]);
  const routingItems = useMemo(() => data?.routing_distribution.map(item => ({ label: item.mode, value: item.count })) ?? [], [data]);
  if (loading) return <LoadingState label="正在汇总全部工作区数据…" />;
  if (error || !data) return <ErrorState message={error?.message ?? '全局统计加载失败'} action={error?.body.error.action} onRetry={reload} />;

  const trendPeak = Math.max(0, ...data.trend.flatMap(point => [point.created, point.completed, point.failed]));
  const metrics = [
    { label: '工作区', value: data.totals.workspaces, suffix: '个', icon: <ApartmentOutlined />, hint: `${data.totals.active_workspaces} 个启用 · ${data.totals.error_workspaces} 个异常` },
    { label: '待复核', value: data.totals.pending_review, suffix: '项', icon: <SafetyCertificateOutlined />, hint: '全工作区人工决策队列' },
    { label: '已排期', value: data.totals.scheduled, suffix: '项', icon: <ClockCircleOutlined />, hint: `P95 排期等待 ${data.totals.p95_schedule_wait_minutes} 分钟` },
    { label: '执行中', value: data.totals.executing, suffix: '项', icon: <ThunderboltOutlined />, hint: '当前 DSH Worker 投影' },
    { label: '完成率', value: data.totals.completion_rate, suffix: '%', icon: <CheckCircleOutlined />, hint: `${data.totals.completed} 个已完成` },
    { label: '失败率', value: data.totals.failure_rate, suffix: '%', icon: <CloseCircleOutlined />, hint: `${data.totals.failed} 个失败任务` },
    { label: '人工确认率', value: data.totals.human_routing_rate, suffix: '%', icon: <WarningOutlined />, hint: `人工改派 ${data.totals.manual_override_rate}%` },
    { label: '平均复核时长', value: data.totals.average_review_minutes, suffix: '分钟', icon: <ClockCircleOutlined />, hint: '从提案创建到首次决策' },
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="GLOBAL / ANALYTICS" title="全局统计" description="汇总全部工作区的任务、交付与路由质量；此处只做聚合和跳转，不提供审批或执行操作。"
        actions={<Space><Segmented value={range} options={(Object.entries(rangeLabels) as Array<[AnalyticsRange, string]>).map(([value, label]) => ({ value, label }))} onChange={value => setRange(value as AnalyticsRange)} /><Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button></Space>} />
      <Alert type="info" showIcon title="全局合计与各工作区合计使用同一组参数化 SQL，自动化测试会对账。" />
      <Row gutter={[12, 12]}>
        {metrics.map((metric, index) => <Col xs={12} xl={6} key={metric.label}><Card variant="borderless" className="metric-card"><Flex justify="space-between"><div><Flex align="center" gap={8}><span className="index-no">A.{String(index + 1).padStart(2, '0')}</span><Text type="secondary">{metric.label}</Text></Flex><Statistic value={metric.value} suffix={metric.suffix} /><Text type="secondary" className="metric-hint">{metric.hint}</Text></div><span className="metric-icon">{metric.icon}</span></Flex></Card></Col>)}
      </Row>
      <Card title={<Space><span className="index-no">T.01</span>任务趋势</Space>}
        extra={<Space size={14} separator={<span className="card-extra-divider" />}><Text type="secondary">峰值 {trendPeak}</Text><Text type="secondary">{rangeLabels[range]}</Text></Space>} variant="borderless">
        <TrendChart points={data.trend} />
      </Card>
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}><Distribution title="Provider 分布" items={providerItems} /></Col>
        <Col xs={24} lg={8}><Distribution title="路由来源" items={routingItems} /></Col>
        <Col xs={24} lg={8}><Distribution title="风险分布" items={Object.entries(data.risk_distribution).map(([label, value]) => ({ label, value }))} /></Col>
      </Row>
      <Card title="按工作区对账" variant="borderless" extra={<Text type="secondary">合计 = {data.workspaces.length} 个工作区</Text>}>
        <Table rowKey="workspace_id" columns={columns} dataSource={data.workspaces} pagination={false} scroll={{ x: 1180 }} />
      </Card>
      <Card title="最近失败与阻塞" variant="borderless">
        {data.recent_failures.length ? <Flex vertical>{data.recent_failures.map(item => <Flex key={`${item.case_id}:${item.failed_at}`} justify="space-between" align="flex-start" gap={16} className="failure-row">
          <div><Space wrap><Tag color="red">失败</Tag><Link to={workspacePath(item.workspace_id, `review/${item.case_id}`)}><Text strong>{item.title}</Text></Link></Space><br /><Text type="secondary">{item.reason}</Text></div>
          <div className="failure-meta"><Text type="secondary">{item.workspace_name}</Text><br /><Text type="secondary" className="small-text">{formatFullDate(item.failed_at)}</Text></div>
        </Flex>)}</Flex> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有失败任务" />}
      </Card>
    </div>
  );
}
