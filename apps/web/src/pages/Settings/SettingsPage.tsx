import { useEffect, useState } from 'react';
import { Alert, App as AntdApp, Button, Card, Col, Descriptions, Flex, Form, InputNumber, Row, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ApiOutlined, DatabaseOutlined, KeyOutlined, ReloadOutlined, SaveOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons';
import type { User } from '@gatehouse/contract';
import type { SettingsResponse } from '../../types/api';
import { api, ApiError } from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { roleLabels } from '../../lib/format';
import { ErrorState, LoadingState, PageHeader } from '../../components/ui';

const { Text, Title } = Typography;

export function SettingsPage() {
  const { user } = useAuth();
  const { message } = AntdApp.useApp();
  const { data, loading, error, reload } = useApiData<SettingsResponse>('/api/settings');
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setMaxConcurrency(data.max_concurrency); }, [data]);
  if (loading) return <LoadingState label="正在读取系统配置…" />;
  if (error || !data) return <ErrorState message={error?.message ?? '设置加载失败'} action={error?.body.error.action} onRetry={reload} />;
  const canEdit = user?.role === 'admin';

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ max_concurrency: maxConcurrency }) });
      message.success('系统配置已保存');
      reload();
    } catch (reason) {
      message.error(reason instanceof ApiError ? reason.body.error.message : '保存失败');
    } finally { setSaving(false); }
  };

  const columns: ColumnsType<User> = [
    { title: '成员', dataIndex: 'name', render: (value, member) => <Space><span className="member-avatar">{value.slice(-2)}</span><div><Text strong>{value}</Text><br /><Text type="secondary" className="small-text">{member.email}</Text></div></Space> },
    { title: '角色', dataIndex: 'role', width: 120, render: (value: User['role']) => <Tag color={value === 'admin' ? 'orange' : value === 'reviewer' ? 'blue' : 'default'}>{roleLabels[value]}</Tag> },
    { title: '权限摘要', dataIndex: 'role', render: (value: User['role']) => value === 'admin' ? '审批、排期、系统配置' : value === 'reviewer' ? '审批、驳回、暂停与恢复排期' : '只读查看' },
  ];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="SYSTEM / SETTINGS" title="系统设置" description="配置执行器连接、调度并发与项目成员权限。仓库和工作区在独立控制面管理。" actions={<Space><Button href="/workspaces">工作区与仓库</Button><Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button></Space>} />
      <Row gutter={[14, 14]}>
        <Col xs={24} xl={12}>
          <Card variant="borderless" title={<Space><ApiOutlined />dsh-superagent 连接</Space>} extra={<Tag color="green">已连接</Tag>}>
            <Descriptions column={1} size="small" items={[
              { key: 'mode', label: '连接模式', children: <Text code>{data.plugin_mode === 'mock' ? 'mock adapter（本地演示）' : 'HTTP + HMAC'}</Text> },
              { key: 'repository', label: '监听仓库', children: data.monitored_repositories.length ? <Space wrap>{data.monitored_repositories.map(repository => <Tag key={`${repository.workspace_id}:${repository.repository_key}`}>{repository.workspace_name} · {repository.repository_key}</Tag>)}</Space> : <Text type="secondary">未配置</Text> },
              { key: 'url', label: '执行器地址', children: <Text code>{data.plugin_base_url}</Text> },
              { key: 'outbox', label: '待重试消息', children: `${data.pending_outbox} 条` },
              { key: 'auth', label: '认证方式', children: 'HMAC-SHA256 · timestamp · nonce' },
            ]} />
            <Alert className="settings-alert" type="info" showIcon title="决策先本地持久化，再由 outbox 可靠投递；网络失败会自动重试。" />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card variant="borderless" title={<Space><DatabaseOutlined />调度与并发</Space>}>
            <Form layout="vertical">
              <Form.Item label="最大并发执行数" extra={!canEdit ? '只有管理员可以修改调度配置。' : undefined}>
                <InputNumber min={1} max={20} value={maxConcurrency} disabled={!canEdit} onChange={value => setMaxConcurrency(value ?? 1)} />
                <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!canEdit || maxConcurrency === data.max_concurrency} onClick={() => void save()} className="settings-save">保存配置</Button>
              </Form.Item>
            </Form>
            <Descriptions column={1} size="small" items={[
              { key: 'policy', label: '调度策略', children: 'SQLite 持久化 · 服务重启恢复' },
              { key: 'retry', label: '回执重试', children: '指数退避 · 自动恢复 pending 消息' },
              { key: 'session', label: '会话有效期', children: `${Math.round(data.session_ttl_seconds / 3600)} 小时` },
            ]} />
          </Card>
        </Col>
      </Row>
      <Card variant="borderless" title={<Space><TeamOutlined />项目成员与权限</Space>} extra={<Tag>{data.users.length} 人</Tag>}>
        <Alert className="settings-alert" type="warning" showIcon title="申请人不能批准自己的需求；viewer 仅可查看。" />
        <Table rowKey="id" columns={columns} dataSource={data.users} pagination={false} size="middle" />
      </Card>
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={12}><Card variant="borderless"><Flex gap={12}><KeyOutlined className="settings-feature-icon" /><div><Title level={5}>密钥与签名</Title><Text type="secondary">会话密钥、事件 HMAC 和插件共享密钥全部通过环境变量注入，生产环境不得使用默认值。</Text></div></Flex></Card></Col>
        <Col xs={24} lg={12}><Card variant="borderless"><Flex gap={12}><SafetyCertificateOutlined className="settings-feature-icon" /><div><Title level={5}>审计不可变</Title><Text type="secondary">SQLite 触发器阻止更新和删除审计记录，所有审批动作保留 trace ID。</Text></div></Flex></Card></Col>
      </Row>
    </div>
  );
}
