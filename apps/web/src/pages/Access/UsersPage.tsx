import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp, Avatar, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tag, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, TeamOutlined, UserSwitchOutlined } from '@ant-design/icons';
import type { User, UserStatus, WorkspaceListItem } from '@gatehouse/contract';
import { api, ApiError } from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { useAuth } from '../../hooks/useAuth';
import { formatFullDate, userStatusLabels } from '../../lib/format';
import { ErrorState, LoadingState, PageHeader } from '../../components/ui';
import type { CreateUserResponse, InvitationLink, RoleListResponse, UserListResponse, UserResponse } from '../../types/api';

const { Text } = Typography;
interface UserFormValues { name: string; email: string; role_id: string; workspace_ids: string[] }

function statusTone(status: UserStatus): string {
  return status === 'active' ? 'green' : status === 'invited' ? 'gold' : 'default';
}

export function UsersPage() {
  const { user: actor } = useAuth();
  const { message } = AntdApp.useApp();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | undefined>();
  const [roleId, setRoleId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [working, setWorking] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [invite, setInvite] = useState<InvitationLink | null>(null);
  const [form] = Form.useForm<UserFormValues>();
  const { data: rolesData } = useApiData<RoleListResponse>('/api/roles');
  const { data: workspaceData } = useApiData<{ items: WorkspaceListItem[] }>('/api/workspaces');
  const roles = rolesData?.items ?? [];
  const workspaces = workspaceData?.items ?? [];
  const activeRoles = useMemo(() => roles.filter((role) => role.status === 'active'), [roles]);
  const counts = useMemo(() => ({
    total,
    active: users.filter((item) => item.status === 'active').length,
    invited: users.filter((item) => item.status === 'invited').length,
    disabled: users.filter((item) => item.status === 'disabled').length,
  }), [total, users]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (roleId) params.set('role_id', roleId);
    api<UserListResponse>(`/api/users?${params.toString()}`)
      .then((result) => { setUsers(result.items); setTotal(result.total); })
      .catch((reason: unknown) => setLoadError(reason instanceof ApiError ? reason : new ApiError({ error: { code: 'UNKNOWN', message: '用户列表加载失败', action: '刷新后重试', trace_id: '' } }, 0)))
      .finally(() => setLoading(false));
  }, [page, roleId, search, status]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ workspace_ids: [] });
    setEditorOpen(true);
  };

  const openEdit = (target: User) => {
    setEditing(target);
    form.setFieldsValue({ name: target.name, email: target.email, role_id: target.role_id, workspace_ids: target.workspace_ids });
    setEditorOpen(true);
  };

  const submitEditor = async () => {
    const values = await form.validateFields();
    setWorking(true);
    try {
      if (editing) {
        await api<UserResponse>(`/api/users/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ name: values.name, role_id: values.role_id, workspace_ids: values.workspace_ids }) });
        message.success('用户信息已更新');
      } else {
        const result = await api<CreateUserResponse>('/api/users', { method: 'POST', body: JSON.stringify(values) });
        setInvite(result.invitation);
        message.success('用户已创建，请复制一次性邀请链接');
      }
      setEditorOpen(false);
      load();
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '保存失败');
    } finally { setWorking(false); }
  };
  const runAction = async (path: string, success: string, method = 'POST') => {
    setWorking(true);
    try {
      await api(path, { method, body: JSON.stringify({}) });
      message.success(success);
      load();
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '操作失败');
    } finally { setWorking(false); }
  };

  const resendInvite = async (target: User) => {
    setWorking(true);
    try {
      const result = await api<{ invitation: InvitationLink }>(`/api/users/${target.id}/invitations`, { method: 'POST', body: '{}' });
      setInvite(result.invitation);
      load();
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '邀请签发失败');
    } finally { setWorking(false); }
  };

  const issueReset = async (target: User) => {
    setWorking(true);
    try {
      const result = await api<{ reset: InvitationLink }>(`/api/users/${target.id}/password-reset`, { method: 'POST', body: '{}' });
      setInvite(result.reset);
      load();
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '重置链接签发失败');
    } finally { setWorking(false); }
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      message.success('链接已复制');
    } catch {
      message.error('浏览器未允许自动复制，请手动选择链接复制');
    }
  };

  const columns: ColumnsType<User> = [
    { title: '用户', key: 'user', render: (_, target) => <Space><Avatar className="person-avatar">{target.name.slice(-2)}</Avatar><div><Text strong>{target.name}</Text><br /><Text type="secondary">{target.email}</Text></div></Space> },
    { title: '角色', dataIndex: 'role_name', width: 140, render: (value: string, target) => <Tag color={target.role === 'admin' ? 'orange' : target.role === 'reviewer' ? 'blue' : 'default'}>{value}</Tag> },
    { title: '工作区', dataIndex: 'workspace_ids', width: 100, render: (value: string[]) => `${value.length} 个` },
    { title: '状态', dataIndex: 'status', width: 120, render: (value: UserStatus) => <Tag color={statusTone(value)}>{userStatusLabels[value]}</Tag> },
    { title: '最后登录', dataIndex: 'last_login_at', width: 160, render: (value: string | null) => <Text type="secondary">{formatFullDate(value)}</Text> },
    { title: '操作', key: 'actions', width: 250, render: (_, target) => <Space size={4} wrap>
      <Button size="small" type="link" onClick={() => openEdit(target)}>编辑</Button>
      {target.status === 'invited' && <Button size="small" type="link" loading={working} onClick={() => void resendInvite(target)}>重发邀请</Button>}
      {target.status === 'active' && <Popconfirm title="签发一次性密码重置链接？" onConfirm={() => void issueReset(target)}><Button size="small" type="link" loading={working}>重置密码</Button></Popconfirm>}
      {target.status === 'disabled'
        ? <Button size="small" type="link" loading={working} onClick={() => void runAction(`/api/users/${target.id}/enable`, '账号已启用')}>启用</Button>
        : <Popconfirm title="停用该账号并立即终止现有会话？" onConfirm={() => void runAction(`/api/users/${target.id}/disable`, '账号已停用')}><Button size="small" type="link" danger disabled={target.id === actor?.id} loading={working}>停用</Button></Popconfirm>}
    </Space> },
  ];
  return (
    <div className="page-stack">
      <PageHeader eyebrow="ACCESS / USERS" title="用户管理" description="创建账号、分配角色与工作区，并控制账号生命周期。"
        actions={<Space><Button href="/access/roles" icon={<UserSwitchOutlined />}>角色管理</Button><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建用户</Button></Space>} />
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card variant="borderless"><Statistic title="用户总数" value={counts.total} prefix={<TeamOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card variant="borderless"><Statistic title="正常账号" value={counts.active} /></Card></Col>
        <Col xs={12} md={6}><Card variant="borderless"><Statistic title="等待激活" value={counts.invited} /></Card></Col>
        <Col xs={12} md={6}><Card variant="borderless"><Statistic title="已停用" value={counts.disabled} /></Card></Col>
      </Row>
      <Card variant="borderless" title="账号列表" extra={<Text type="secondary">仅展示当前筛选结果</Text>}>
        <Space wrap className="table-toolbar">
          <Input.Search allowClear placeholder="搜索姓名或邮箱" onSearch={(value) => { setSearch(value.trim()); setPage(1); }} style={{ width: 260 }} />
          <Select allowClear placeholder="状态" style={{ width: 140 }} value={status} onChange={(value) => { setStatus(value); setPage(1); }}
            options={(['active', 'invited', 'disabled'] as UserStatus[]).map((value) => ({ value, label: userStatusLabels[value] }))} />
          <Select allowClear placeholder="角色" style={{ width: 180 }} value={roleId} onChange={(value) => { setRoleId(value); setPage(1); }}
            options={activeRoles.map((role) => ({ value: role.id, label: role.name }))} />
        </Space>
        {loadError ? <ErrorState message={loadError.body.error.message} action={loadError.body.error.action} onRetry={load} /> : (
          <Table rowKey="id" columns={columns} dataSource={users} loading={loading} scroll={{ x: 1050 }}
            pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage }} />
        )}
      </Card>

      <Modal open={editorOpen} title={editing ? '编辑用户' : '新建用户'} width={620} destroyOnHidden forceRender
        onCancel={() => setEditorOpen(false)} onOk={() => void submitEditor()} confirmLoading={working} okText={editing ? '保存' : '创建并生成邀请'}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col span={12}><Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}><Input maxLength={80} /></Form.Item></Col>
            <Col span={12}><Form.Item label="工作邮箱" name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}><Input disabled={Boolean(editing)} /></Form.Item></Col>
          </Row>
          <Form.Item label="角色" name="role_id" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={activeRoles.map((role) => ({ value: role.id, label: `${role.name} · ${role.code}` }))} />
          </Form.Item>
          <Form.Item label="可访问工作区" name="workspace_ids" extra="管理员自动访问全部工作区；其他角色需要明确加入工作区。">
            <Select mode="multiple" allowClear placeholder="选择工作区" options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={Boolean(invite)} title="一次性链接" width={620} onCancel={() => setInvite(null)}
        footer={<Space><Button onClick={() => setInvite(null)}>关闭</Button><Button type="primary" icon={<CopyOutlined />} onClick={() => void copyInvite()}>复制链接</Button></Space>}>
        <div className="invite-link-panel">
          <SafetyCertificateOutlined className="invite-link-icon" />
          <Text strong>链接只显示一次</Text>
          <Text type="secondary">请通过安全渠道发送给用户。链接将在 {formatFullDate(invite?.expires_at)} 失效。</Text>
          <Input.TextArea readOnly autoSize={{ minRows: 3, maxRows: 6 }} value={invite?.url ?? ''} />
        </div>
      </Modal>
    </div>
  );
}
