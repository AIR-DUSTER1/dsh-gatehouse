import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert, App as AntdApp, Avatar, Button, Card, Checkbox, Col, DatePicker, Descriptions, Divider, Flex, Form,
  Empty, Input, Modal, Row, Space, Tag, Timeline, Typography,
} from 'antd';
import {
  ArrowLeftOutlined, CalendarOutlined, CheckCircleOutlined, CloseCircleOutlined, CodeOutlined, FileTextOutlined,
  InfoCircleOutlined, SafetyCertificateOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { DecisionType, ReviewCaseDetail } from '@gatehouse/contract';
import { api, ApiError } from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { actionLabels, decisionLabels, formatFullDate, riskLabels, shortHash, sourceLabel, statusExplain, statusLabels } from '../../lib/format';
import { Avatar as PersonAvatar, ErrorState, LoadingState, RiskBadge, SourceBadge, StatusBadge } from '../../components/ui';
import type { DecisionResponse } from '../../types/api';

const { Text, Title, Paragraph } = Typography;

interface DecisionForm { comment: string; risk_confirmed: boolean; schedule_at?: Dayjs; expires_at?: Dayjs }

export function CaseDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<DecisionForm>();
  const { data, loading, error, reload } = useApiData<ReviewCaseDetail>(`/api/review-cases/${id}`);
  const [action, setAction] = useState<DecisionType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const proposal = data?.proposals[0] ?? null;
  const latestDecision = data?.decisions[0] ?? null;
  const isReviewer = user?.role === 'reviewer' || user?.role === 'admin';
  const selfApproval = Boolean(data && user?.name === data.review_case.requester);
  const canReview = Boolean(proposal?.status === 'pending_review' && isReviewer);

  useEffect(() => {
    if (!action) return;
    form.resetFields();
    form.setFieldsValue({ comment: '', risk_confirmed: false, schedule_at: dayjs().add(2, 'hour'), expires_at: dayjs().add(26, 'hour') });
    setFormError('');
  }, [action, form]);

  if (loading) return <LoadingState label="正在加载需求与评估提案…" />;
  if (error || !data || !proposal) return <ErrorState message={error?.message ?? '需求详情加载失败'} action={error?.body.error.action} onRetry={reload} />;

  const submit = async (values: DecisionForm) => {
    if (!action) return;
    if (action === 'approve' && (!values.schedule_at || !values.expires_at)) { setFormError('请选择排期时间和授权过期时间。'); return; }
    setSubmitting(true); setFormError('');
    const payload = action === 'approve'
      ? { decision: action, comment: values.comment.trim(), schedule_at: values.schedule_at!.toISOString(), expires_at: values.expires_at!.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, risk_confirmed: true }
      : { decision: action, comment: values.comment.trim(), risk_confirmed: true };
    try {
      await api<DecisionResponse>(`/api/proposals/${proposal.id}/decision`, {
        method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(payload),
      });
      setAction(null);
      message.success(action === 'approve' ? '审批已完成，任务已进入排期。' : action === 'reject' ? '需求已驳回，不会触发执行。' : '已要求补充信息，等待新提案。');
      reload();
    } catch (reason) {
      setFormError(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '提交失败，请重试。');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="page-stack detail-page">
      <Flex justify="space-between" align="center">
        <Link to="/review"><Button type="text" icon={<ArrowLeftOutlined />}>返回复核中心</Button></Link>
        <Text type="secondary" className="small-text">CASE / {data.review_case.id}</Text>
      </Flex>

      <Card variant="borderless" className="detail-header-card">
        <Flex justify="space-between" align="flex-start" gap={28} wrap>
          <div className="detail-title-block">
            <Space wrap><SourceBadge source={data.review_case.source} /><StatusBadge status={data.review_case.status} /><RiskBadge risk={data.review_case.risk_level} /></Space>
            <Title level={2}>{data.review_case.title}</Title>
            <Space separator={<Divider vertical />} wrap><Space><PersonAvatar name={data.review_case.requester} size="sm" /><Text>{data.review_case.requester}</Text></Space><Text type="secondary">{formatFullDate(data.review_case.created_at)}</Text><Text type="secondary">{sourceLabel(data.review_case.source)}</Text></Space>
          </div>
          <div className="state-summary"><Text type="secondary">当前状态</Text><Title level={4}>{statusLabels[data.review_case.status]}</Title><Paragraph type="secondary">{statusExplain[data.review_case.status]}</Paragraph></div>
        </Flex>
      </Card>

      <Row gutter={[14, 14]} align="top">
        <Col xs={24} xl={14}>
          <Flex vertical gap={14}>
            <Card title={<Space><FileTextOutlined />原始需求</Space>} extra={<Text copyable={{ text: data.review_case.requirement_text }}>复制</Text>} variant="borderless">
              <Paragraph className="requirement-text">{data.review_case.requirement_text}</Paragraph>
              <Descriptions column={{ xs: 1, md: 2 }} size="small" items={[
                { key: 'context', label: '来源上下文', children: data.review_case.source_context || '—' },
                { key: 'message', label: '原始消息', children: data.review_case.message_url ? <a href={data.review_case.message_url} target="_blank" rel="noreferrer">打开原消息</a> : '—' },
                { key: 'requirement_hash', label: '需求哈希', children: <Text code copyable={{ text: data.review_case.requirement_hash }}>{shortHash(data.review_case.requirement_hash)}</Text> },
                { key: 'revision', label: '提案版本', children: `Assessment revision v${proposal.assessment_revision}` },
              ]} />
            </Card>

            <Card title={<Space><SafetyCertificateOutlined />Agent 调研结论</Space>} extra={<Tag color="purple">dsh-superagent</Tag>} variant="borderless">
              <Paragraph>{proposal.summary}</Paragraph>
              <Alert type={proposal.risk === 'critical' || proposal.risk === 'high' ? 'warning' : 'info'} showIcon icon={<WarningOutlined />} title={`${riskLabels[proposal.risk]} · 风险说明`} description={proposal.risk_reason} />
              <Space wrap className="tag-row">{proposal.rule_hits.map(rule => <Tag key={rule}>{rule}</Tag>)}</Space>
            </Card>

            <Card title="历史提案版本" variant="borderless">
              <Timeline items={data.proposals.map((version, index) => ({
                color: index === 0 ? 'blue' : 'gray',
                content: <div><Space><Text strong>{index === 0 ? '当前评估' : '历史评估'}</Text><Tag>v{version.assessment_revision}</Tag><StatusBadge status={version.status} /></Space><Paragraph type="secondary" className="version-summary">{version.summary}</Paragraph><Text type="secondary" className="small-text">{formatFullDate(version.created_at)}</Text></div>,
              }))} />
            </Card>

            <Card title="决策与审计" variant="borderless">
              {latestDecision ? <Alert type={latestDecision.decision === 'approve' ? 'success' : latestDecision.decision === 'reject' ? 'error' : 'warning'} showIcon title={decisionLabels[latestDecision.decision]} description={<><div>{latestDecision.comment}</div><Text type="secondary" className="small-text">{latestDecision.reviewer} · {formatFullDate(latestDecision.created_at)}</Text></>} /> : <Text type="secondary">尚未产生人工决策。</Text>}
              <Timeline className="audit-timeline" items={data.audit_events.map(event => ({ content: <Flex justify="space-between" gap={12}><div><Text strong>{actionLabels[event.action] ?? event.action}</Text><br /><Text type="secondary" className="small-text">{event.actor}</Text></div><Text type="secondary" className="small-text">{formatFullDate(event.created_at)}</Text></Flex> }))} />
            </Card>
          </Flex>
        </Col>

        <Col xs={24} xl={10}>
          <Flex vertical gap={14}>
            <Card title="建议执行范围" extra={<Tag>REV {proposal.assessment_revision}</Tag>} variant="borderless">
              <Flex vertical gap={9}>{proposal.scope.map(item => <Flex key={item} gap={8} align="flex-start"><CheckCircleOutlined className="success-icon" /><Text>{item}</Text></Flex>)}</Flex>
              <Divider />
              <Text type="secondary">Scope hash</Text><br /><Text code copyable={{ text: proposal.scope_hash }}>{shortHash(proposal.scope_hash)}</Text>
            </Card>

            <Card title={<Space><CodeOutlined />影响文件</Space>} extra={<Tag>{proposal.impact_files.length} 个</Tag>} variant="borderless">
              {proposal.impact_files.length ? <Flex vertical gap={7}>{proposal.impact_files.map(file => <Text key={file} code copyable>{file}</Text>)}</Flex> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到文件级影响" />}
            </Card>

            <Card title="验证计划" variant="borderless">
              <Flex vertical gap={10}>{proposal.test_plan.map((item, index) => <Flex key={item} gap={8} align="flex-start"><Tag>{index + 1}</Tag><Text>{item}</Text></Flex>)}</Flex>
            </Card>

            <Card title="成本与授权" variant="borderless">
              <Descriptions column={1} size="small" items={[
                { key: 'cost', label: '预估成本', children: proposal.estimated_cost },
                { key: 'risk', label: '风险等级', children: riskLabels[proposal.risk] },
                ...(data.grant ? [
                  { key: 'schedule', label: '排期时间', children: formatFullDate(data.grant.schedule_at) },
                  { key: 'expires', label: '授权过期', children: formatFullDate(data.grant.expires_at) },
                  { key: 'grant', label: 'Grant ID', children: <Text code copyable={{ text: data.grant.id }}>{shortHash(data.grant.id)}</Text> },
                ] : []),
              ]} />
            </Card>

            {proposal.status === 'pending_review' && <Card title="人工复核决策" variant="borderless" className="decision-card">
              {!isReviewer && <Alert type="info" showIcon title="当前账号为只读成员，不能提交审批决策。" />}
              {selfApproval && isReviewer && <Alert type="warning" showIcon title="申请人与当前账号相同，不能批准自己的需求；仍可驳回或要求补充。" />}
              <Flex gap={8} wrap className="decision-actions">
                <Button type="primary" icon={<CheckCircleOutlined />} disabled={!canReview || selfApproval} onClick={() => setAction('approve')}>批准并排期</Button>
                <Button icon={<InfoCircleOutlined />} disabled={!canReview} onClick={() => setAction('request_info')}>要求补充</Button>
                <Button danger icon={<CloseCircleOutlined />} disabled={!canReview} onClick={() => setAction('reject')}>驳回</Button>
              </Flex>
              <Text type="secondary" className="decision-hint">决策会绑定当前需求哈希与范围哈希，范围变化将使批准自动失效。</Text>
            </Card>}
          </Flex>
        </Col>
      </Row>

      <Modal
        open={Boolean(action)} title={action ? decisionLabels[action] : ''} width={620} confirmLoading={submitting}
        onCancel={() => setAction(null)} onOk={() => form.submit()} okText={action ? decisionLabels[action] : '提交'}
        destroyOnHidden
      >
        <Form<DecisionForm> form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          {action === 'approve' && <Row gutter={12}><Col span={12}><Form.Item label="排期时间" name="schedule_at" rules={[{ required: true }]}><DatePicker showTime className="full-width" suffixIcon={<CalendarOutlined />} /></Form.Item></Col><Col span={12}><Form.Item label="授权过期时间" name="expires_at" rules={[{ required: true }]}><DatePicker showTime className="full-width" /></Form.Item></Col></Row>}
          <Form.Item label="审批意见" name="comment" rules={[{ required: true, min: 2, message: '请输入至少 2 个字符' }]}><Input.TextArea rows={4} placeholder="说明批准依据、驳回原因或需要补充的信息" /></Form.Item>
          <Form.Item name="risk_confirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error('请确认已阅读风险与范围')) }]}><Checkbox>我已阅读并确认执行范围、影响文件、风险说明和测试计划。</Checkbox></Form.Item>
          {formError && <Alert type="error" showIcon title={formError} />}
          <Divider />
          <Descriptions size="small" column={2} items={[{ key: 'requirement', label: '需求哈希', children: <Text code>{shortHash(data.review_case.requirement_hash)}</Text> }, { key: 'scope', label: '范围哈希', children: <Text code>{shortHash(proposal.scope_hash)}</Text> }]} />
        </Form>
      </Modal>
    </div>
  );
}
