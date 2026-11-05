import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, App as AntdApp, Button, Card, Col, DatePicker, Empty, Flex, Form, Input, Modal, Popconfirm, Row, Space, Statistic, Typography,
} from 'antd';
import type { ScheduleListItem } from '@gatehouse/contract';
import { CalendarOutlined, ClockCircleOutlined, ReloadOutlined, RetweetOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api, ApiError } from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { useWorkspace, workspacePath } from '../../hooks/useWorkspace';
import { formatFullDate, hasPermission } from '../../lib/format';
import type { ScheduleActionResponse, ScheduleResponse } from '../../types/api';
import { ErrorState, LoadingState, PageHeader, RiskBadge, StatusBadge } from '../../components/ui';

const { Text, Title } = Typography;
const groups = [
  { key: 'scheduled', no: 'C.1', title: '待执行', hint: '按计划时间触发 dsh-superagent', statuses: ['scheduled', 'paused'] },
  { key: 'executing', no: 'C.2', title: '执行中', hint: 'Worker 正在执行或等待回执', statuses: ['executing'] },
  { key: 'completed', no: 'C.3', title: '已完成', hint: '交付结果已经回写', statuses: ['completed'] },
  { key: 'failed', no: 'C.4', title: '异常', hint: '需要人工检查失败原因', statuses: ['failed'] },
  { key: 'cancelled', no: 'C.5', title: '已撤回', hint: '授权已吊销，等待重新复核', statuses: ['cancelled'] },
];

interface RescheduleForm { schedule_at: Dayjs; expires_at: Dayjs; reason: string }
interface WithdrawForm { reason: string }

export function SchedulePage() {
  const { user } = useAuth();
  const { currentId } = useWorkspace();
  const workspaceId = currentId ?? '';
  const { message } = AntdApp.useApp();
  const { data, loading, error, reload } = useApiData<ScheduleResponse>(`/api/schedule?workspace_id=${encodeURIComponent(workspaceId)}`);
  const [pendingId, setPendingId] = useState('');
  const [rescheduleItem, setRescheduleItem] = useState<ScheduleListItem | null>(null);
  const [withdrawItem, setWithdrawItem] = useState<ScheduleListItem | null>(null);
  const [rescheduleForm] = Form.useForm<RescheduleForm>();
  const [withdrawForm] = Form.useForm<WithdrawForm>();
  const canControl = hasPermission(user, 'schedule.control');

  useEffect(() => {
    if (!rescheduleItem) return;
    rescheduleForm.setFieldsValue({ schedule_at: dayjs(rescheduleItem.schedule_at), expires_at: dayjs(rescheduleItem.expires_at), reason: '' });
  }, [rescheduleItem, rescheduleForm]);

  useEffect(() => {
    if (withdrawItem) withdrawForm.setFieldsValue({ reason: '' });
  }, [withdrawItem, withdrawForm]);

  if (loading) return <LoadingState label="正在读取持久化排期…" />;
  if (error || !data) return <ErrorState message={error?.message ?? '排期加载失败'} action={error?.body.error.action} onRetry={reload} />;

  const showFailure = (reason: unknown, fallback: string) => {
    message.error(reason instanceof ApiError ? reason.body.error.message : fallback);
  };

  const act = async (item: ScheduleListItem, action: 'pause' | 'resume') => {
    setPendingId(item.id);
    try {
      await api<ScheduleActionResponse>(`/api/schedule/${item.id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      message.success(action === 'pause' ? '排期已暂停' : '排期已恢复');
      reload();
    } catch (reason) { showFailure(reason, '操作失败'); }
    finally { setPendingId(''); }
  };

  const retryExecution = async (item: ScheduleListItem) => {
    setPendingId(item.id);
    try {
      await api<ScheduleActionResponse>(`/api/schedule/${item.id}/retry-execution`, { method: 'POST', body: JSON.stringify({}) });
      message.success('已重新提交执行同步');
      reload();
    } catch (reason) { showFailure(reason, '重试执行失败'); }
    finally { setPendingId(''); }
  };

  const submitReschedule = async (values: RescheduleForm) => {
    if (!rescheduleItem) return;
    setPendingId(rescheduleItem.id);
    try {
      await api<ScheduleActionResponse>(`/api/schedule/${rescheduleItem.id}/reschedule`, {
        method: 'POST', body: JSON.stringify({
          schedule_at: values.schedule_at.toISOString(), expires_at: values.expires_at.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, reason: values.reason.trim(),
        }),
      });
      message.success('排期已修改，正在同步新的开发授权');
      setRescheduleItem(null);
      reload();
    } catch (reason) { showFailure(reason, '修改排期失败'); }
    finally { setPendingId(''); }
  };

  const submitWithdraw = async (values: WithdrawForm) => {
    if (!withdrawItem) return;
    setPendingId(withdrawItem.id);
    try {
      await api<ScheduleActionResponse>(`/api/schedule/${withdrawItem.id}/withdraw`, {
        method: 'POST', body: JSON.stringify({ reason: values.reason.trim() }),
      });
      message.success('排期已撤回，需求已回到待复核');
      setWithdrawItem(null);
      reload();
    } catch (reason) { showFailure(reason, '撤回排期失败'); }
    finally { setPendingId(''); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="SEC.03 / SCHEDULING" title="执行调度" description="排期持久化在 SQLite 中；修改或撤回会同步吊销/更新执行侧的一次性授权。" actions={<Button icon={<ReloadOutlined />} onClick={reload}>刷新状态</Button>} />
      <Row gutter={[12, 12]}>
        {[
          { label: '当前执行数', value: `${data.metrics.executing} / ${data.metrics.max_concurrency}`, icon: <ClockCircleOutlined />, color: '#191817' },
          { label: '今日待执行', value: data.metrics.due_today, icon: <CalendarOutlined />, color: '#e8480c' },
          { label: '已超时', value: data.metrics.overdue, icon: <WarningOutlined />, color: '#b5690a' },
          { label: '阻塞任务', value: data.metrics.blocked, icon: <WarningOutlined />, color: '#c73325' },
        ].map((item, index) => <Col xs={12} lg={6} key={item.label}><Card variant="borderless" className="metric-card"><Flex justify="space-between"><div><Flex align="center" gap={8}><span className="index-no">M.{String(index + 1).padStart(2, '0')}</span><Text type="secondary">{item.label}</Text></Flex><Statistic value={item.value} /></div><span className="metric-icon" style={{ color: item.color }}>{item.icon}</span></Flex></Card></Col>)}
      </Row>
      <div className="schedule-grid">
        {groups.map(group => {
          const items = data.items.filter(item => group.statuses.includes(item.status));
          return <Card key={group.key} title={<Space size={10}><span className="index-no">{group.no}</span>{group.title}<span className="mono-label">{items.length}</span></Space>} variant="borderless" className="schedule-column">
            <Text type="secondary" className="small-text column-hint">{group.hint}</Text>
            {items.length ? <Flex vertical gap={10}>{items.map(item => <Card key={item.id} size="small" className="schedule-item">
              <Flex justify="space-between" align="flex-start" gap={8}><Link to={workspacePath(workspaceId, `review/${item.review_case_id}`)}><Title level={5}>{item.title}</Title></Link><RiskBadge risk={item.risk_level} /></Flex>
              <Text type="secondary" className="schedule-summary">{item.proposal_summary}</Text>
              <Space className="schedule-meta"><StatusBadge status={item.status} /><Text type="secondary" className="small-text">{formatFullDate(item.schedule_at)}</Text></Space>
              {item.status === 'scheduled' && !item.approval_synced_at && <Text type="warning" className="small-text">等待同步到执行器，同步前不会执行</Text>}
              {item.last_error && <Text type={item.status === 'cancelled' ? 'secondary' : 'danger'} className="small-text">
                {item.status === 'cancelled' ? `撤回原因：${item.last_error}` : item.last_error}
              </Text>}
              {item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer">查看 Pull Request</a>}
              {canControl && item.status === 'failed' && item.retryable && <Button size="small" icon={<RetweetOutlined />}
                loading={pendingId === item.id} onClick={() => void retryExecution(item)}>重试执行同步</Button>}
              {canControl && ['scheduled', 'paused'].includes(item.status) && <Space wrap className="schedule-actions">
                <Popconfirm title={item.status === 'paused' ? '恢复此排期？' : '暂停此排期？'} onConfirm={() => void act(item, item.status === 'paused' ? 'resume' : 'pause')}><Button size="small" loading={pendingId === item.id}>{item.status === 'paused' ? '恢复' : '暂停'}</Button></Popconfirm>
                <Button size="small" onClick={() => setRescheduleItem(item)}>修改排期</Button>
                <Button size="small" danger onClick={() => setWithdrawItem(item)}>撤回排期</Button>
              </Space>}
            </Card>)}</Flex> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />}
          </Card>;
        })}
      </div>

      <Modal open={Boolean(rescheduleItem)} title="修改开发排期" width={620} confirmLoading={pendingId === rescheduleItem?.id}
        onCancel={() => setRescheduleItem(null)} onOk={() => rescheduleForm.submit()} okText="保存并重新同步" destroyOnHidden>
        <Alert type="info" showIcon title="修改会生成新的授权时间，并重新同步给执行侧；执行开始后不能再修改。" />
        <Form form={rescheduleForm} layout="vertical" onFinish={submitReschedule} requiredMark={false} className="modal-form">
          <Row gutter={12}>
            <Col span={12}><Form.Item label="开发开始时间" name="schedule_at" rules={[{ required: true, message: '请选择开发开始时间' }]}><DatePicker showTime className="full-width" /></Form.Item></Col>
            <Col span={12}><Form.Item label="授权过期时间" name="expires_at" rules={[{ required: true, message: '请选择授权过期时间' }]}><DatePicker showTime className="full-width" /></Form.Item></Col>
          </Row>
          <Form.Item label="修改原因（选填）" name="reason"><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        </Form>
      </Modal>

      <Modal open={Boolean(withdrawItem)} title="撤回开发排期" width={560} confirmLoading={pendingId === withdrawItem?.id} okButtonProps={{ danger: true }}
        onCancel={() => setWithdrawItem(null)} onOk={() => withdrawForm.submit()} okText="确认撤回" destroyOnHidden>
        <Alert type="warning" showIcon title="撤回后当前授权会立即吊销，需求回到待复核；不会触发开发。" />
        <Form form={withdrawForm} layout="vertical" onFinish={submitWithdraw} requiredMark={false} className="modal-form">
          <Form.Item label="撤回原因（选填）" name="reason"><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
