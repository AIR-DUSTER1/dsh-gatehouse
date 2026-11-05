import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, App as AntdApp, Button, Card, Col, Descriptions, Divider, Empty, Flex, Form, Input, InputNumber,
  Modal, Popconfirm, Progress, Row, Select, Space, Statistic, Steps, Switch, Table, Tag, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ApartmentOutlined, CheckCircleOutlined, DatabaseOutlined, GithubOutlined, GitlabOutlined, GlobalOutlined,
  PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SyncOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { RepositoryDescriptionSuggestion, RepositoryDiscovery, RepositoryProvider, User, WorkspaceListItem, WorkspaceRepositoryRecord } from '@gatehouse/contract';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useWorkspace, workspacePath } from '../../hooks/useWorkspace';
import { formatFullDate, hasPermission } from '../../lib/format';
import { Badge, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import type {
  RepositoryConfirmationResponse,
  RepositoryDescriptionResponse,
  RepositoryValidationResponse,
  WorkspaceResponse,
  WorkspaceSyncResponse,
} from '../../types/api';

const { Text, Title, Paragraph } = Typography;

interface RepositoryForm {
  name: string;
  slug: string;
  workspace_description: string;
  provider: RepositoryProvider;
  repository_key: string;
  api_base_url: string;
  web_base_url: string;
  clone_url: string;
  default_branch: string;
  credential_ref: string;
  observe_issues: boolean;
  observe_change_requests: boolean;
  observe_comments: boolean;
  observe_ci: boolean;
}

interface DescriptionForm {
  short_description: string;
  capabilities: string;
  routing_keywords: string;
  exclusions: string;
  confidence: number;
}

const providerLabels: Record<RepositoryProvider, string> = {
  github: 'GitHub / GHE', gitlab: 'GitLab', gitea: 'Gitea / Forgejo', bitbucket: 'Bitbucket', generic: '通用 Git / 内网仓库',
};

function providerIcon(provider: RepositoryProvider) {
  if (provider === 'github') return <GithubOutlined />;
  if (provider === 'gitlab') return <GitlabOutlined />;
  return <GlobalOutlined />;
}

function statusTone(status: WorkspaceListItem['status']): 'neutral' | 'ok' | 'warn' | 'bad' | 'signal' {
  return status === 'active' ? 'ok' : status === 'error' ? 'bad' : status === 'disabled' ? 'neutral' : 'warn';
}

export function WorkspacesPage() {
  const { message } = AntdApp.useApp();
  const { user } = useAuth();
  const { workspaces, loading, error, reload } = useWorkspace();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'add'>('create');
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('');
  const [step, setStep] = useState(0);
  const [repository, setRepository] = useState<WorkspaceRepositoryRecord | null>(null);
  const [discovery, setDiscovery] = useState<RepositoryDiscovery | null>(null);
  const [descriptionSuggestion, setDescriptionSuggestion] = useState<RepositoryDescriptionSuggestion | null>(null);
  const [working, setWorking] = useState(false);
  const [flowError, setFlowError] = useState('');
  const [memberWorkspace, setMemberWorkspace] = useState<WorkspaceListItem | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [memberToAdd, setMemberToAdd] = useState<string | null>(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [repositoryForm] = Form.useForm<RepositoryForm>();
  const [descriptionForm] = Form.useForm<DescriptionForm>();
  const canManage = hasPermission(user, 'workspace.manage');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((workspace) => `${workspace.name} ${workspace.slug} ${workspace.repositories.map(repo => `${repo.repository_key} ${repo.provider}`).join(' ')}`.toLowerCase().includes(term));
  }, [search, workspaces]);

  const summary = useMemo(() => ({
    total: workspaces.length,
    active: workspaces.filter(workspace => workspace.status === 'active').length,
    onboarding: workspaces.filter(workspace => workspace.status === 'onboarding').length,
    repositories: workspaces.reduce((total, workspace) => total + workspace.repositories.length, 0),
  }), [workspaces]);

  const openCreate = () => {
    setMode('create'); setTargetWorkspaceId(''); setStep(0); setRepository(null); setDiscovery(null); setDescriptionSuggestion(null); setFlowError('');
    repositoryForm.resetFields();
    repositoryForm.setFieldsValue({
      provider: 'github', default_branch: 'main', credential_ref: '', api_base_url: 'https://api.github.com',
      observe_issues: true, observe_change_requests: true, observe_comments: true, observe_ci: true,
    });
    setOpen(true);
  };

  const openAddRepository = (workspace: WorkspaceListItem) => {
    setMode('add'); setTargetWorkspaceId(workspace.id); setStep(0); setRepository(null); setDiscovery(null); setDescriptionSuggestion(null); setFlowError('');
    repositoryForm.resetFields();
    repositoryForm.setFieldsValue({
      name: workspace.name, slug: workspace.slug, workspace_description: workspace.description,
      provider: 'github', default_branch: 'main', credential_ref: '', api_base_url: 'https://api.github.com',
      observe_issues: true, observe_change_requests: true, observe_comments: true, observe_ci: true,
    });
    setOpen(true);
  };

  const fail = (reason: unknown, fallback: string) => {
    setFlowError(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : fallback);
  };

  const connectRepository = async (values: RepositoryForm) => {
    setWorking(true); setFlowError('');
    const repositoryPayload = {
      provider: values.provider,
      repository_key: values.repository_key.trim(),
      api_base_url: values.api_base_url?.trim() || null,
      web_base_url: values.web_base_url.trim(),
      clone_url: values.clone_url.trim(),
      default_branch: values.default_branch.trim() || 'main',
      credential_ref: values.credential_ref.trim(),
      custom_ca_ref: null,
      observe: {
        issues: values.observe_issues,
        change_requests: values.observe_change_requests,
        comments: values.observe_comments,
        ci: values.observe_ci,
      },
    };
    try {
      let repo: WorkspaceRepositoryRecord;
      if (mode === 'create') {
        const created = await api<WorkspaceResponse>('/api/workspaces', {
          method: 'POST', body: JSON.stringify({
            name: values.name.trim(), slug: values.slug.trim(), description: values.workspace_description.trim(),
            repository: repositoryPayload,
          }),
        });
        repo = created.workspace.repositories[0]!;
      } else {
        const created = await api<{ repository: WorkspaceRepositoryRecord; trace_id: string }>(`/api/workspaces/${targetWorkspaceId}/repositories`, {
          method: 'POST', body: JSON.stringify(repositoryPayload),
        });
        repo = created.repository;
      }
      setRepository(repo);
      const validation = await api<RepositoryValidationResponse>(`/api/repositories/${repo.id}/validate`, { method: 'POST', body: '{}' });
      const needsChangeRequests = validation.discovery.provider === 'github' || validation.discovery.provider === 'gitlab' || validation.discovery.provider === 'gitea';
      if (!validation.discovery.permissions.read || !validation.discovery.permissions.push
        || (needsChangeRequests && !validation.discovery.permissions.change_requests)) {
        throw new Error('仓库读取、推送或变更请求权限不完整');
      }
      setDiscovery(validation.discovery);
      try {
        const described = await api<RepositoryDescriptionResponse>(`/api/repositories/${repo.id}/describe`, { method: 'POST', body: '{}' });
        setDescriptionSuggestion(described.suggestion);
        descriptionForm.setFieldsValue({
          short_description: described.suggestion.short_description,
          capabilities: described.suggestion.capabilities.join('，'),
          routing_keywords: described.suggestion.routing_keywords.join('，'),
          exclusions: described.suggestion.exclusions.join('，'),
          confidence: described.suggestion.confidence,
        });
      } catch (reason) {
        setDescriptionSuggestion(null);
        descriptionForm.setFieldsValue({ short_description: '', capabilities: '', routing_keywords: '', exclusions: '', confidence: 0.75 });
        setFlowError(reason instanceof ApiError
          ? `模型描述生成失败：${reason.body.error.message}。请手动填写后继续。`
          : '模型描述生成失败，请手动填写后继续。');
      }
      setStep(1);
    } catch (reason) {
      fail(reason, '仓库接入失败，请检查地址与权限');
    } finally { setWorking(false); }
  };

  const confirmDescription = async (values: DescriptionForm) => {
    if (!repository) return;
    const split = (value: string) => value.split(/[，,、\n]/).map(item => item.trim()).filter(Boolean);
    setWorking(true); setFlowError('');
    try {
      await api<RepositoryConfirmationResponse>(`/api/repositories/${repository.id}/description`, {
        method: 'PUT', body: JSON.stringify({
          short_description: values.short_description.trim(),
          capabilities: split(values.capabilities),
          routing_keywords: split(values.routing_keywords),
          exclusions: split(values.exclusions),
          confidence: values.confidence,
          ...(descriptionSuggestion ? {
            source_fingerprint: descriptionSuggestion.source_fingerprint,
            generated_at: descriptionSuggestion.generated_at,
            model: descriptionSuggestion.model,
          } : discovery ? { source_fingerprint: discovery.source_fingerprint } : {}),
        }),
      });
      setStep(2);
      await api<WorkspaceSyncResponse>('/api/workspaces/sync', { method: 'POST', body: '{}' });
      message.success('仓库描述已确认，工作区配置已同步到 dsh-superagent');
      setOpen(false);
      reload();
    } catch (reason) {
      setStep(1);
      fail(reason, '描述确认或同步失败');
    } finally { setWorking(false); }
  };

  const syncAll = async () => {
    setWorking(true);
    try {
      const result = await api<WorkspaceSyncResponse>('/api/workspaces/sync', { method: 'POST', body: '{}' });
      message.success(`已同步 ${result.sync.applied} 个仓库配置`);
      reload();
    } catch (reason) {
      message.error(reason instanceof ApiError ? reason.body.error.message : '同步失败');
    } finally { setWorking(false); }
  };

  const disableWorkspace = async (workspace: WorkspaceListItem) => {
    try {
      await api(`/api/workspaces/${workspace.id}/disable`, { method: 'POST', body: '{}' });
      message.success('工作区已停用，未完成排期已撤回');
      reload();
    } catch (reason) {
      message.error(reason instanceof ApiError ? reason.body.error.message : '停用失败');
    }
  };

  const openMembers = async (workspace: WorkspaceListItem) => {
    setMemberWorkspace(workspace);
    setMemberToAdd(null);
    try {
      const [memberResponse, settings] = await Promise.all([
        api<{ items: User[] }>(`/api/workspaces/${workspace.id}/members`),
        api<{ items: User[] }>('/api/users/options'),
      ]);
      setMembers(memberResponse.items);
      setAllUsers(settings.items);
    } catch (reason) {
      message.error(reason instanceof ApiError ? reason.body.error.message : '成员加载失败');
    }
  };

  const addMember = async () => {
    if (!memberWorkspace || !memberToAdd) return;
    setMemberSaving(true);
    try {
      await api(`/api/workspaces/${memberWorkspace.id}/members/${memberToAdd}`, { method: 'PUT', body: '{}' });
      const user = allUsers.find(item => item.id === memberToAdd);
      if (user) setMembers(prev => [...prev, user]);
      setMemberToAdd(null);
      message.success('工作区成员已添加');
    } catch (reason) {
      message.error(reason instanceof ApiError ? reason.body.error.message : '添加成员失败');
    } finally { setMemberSaving(false); }
  };

  const removeMember = async (userId: string) => {
    if (!memberWorkspace) return;
    setMemberSaving(true);
    try {
      await api(`/api/workspaces/${memberWorkspace.id}/members/${userId}`, { method: 'DELETE' });
      setMembers(prev => prev.filter(item => item.id !== userId));
      message.success('工作区成员已移除');
    } catch (reason) {
      message.error(reason instanceof ApiError ? reason.body.error.message : '移除成员失败');
    } finally { setMemberSaving(false); }
  };

  const columns: ColumnsType<WorkspaceListItem> = [
    {
      title: '工作区', dataIndex: 'name', width: 180,
      render: (_, workspace) => <div><Space><Badge tone={statusTone(workspace.status)}>{workspace.status === 'active' ? '启用' : workspace.status === 'error' ? '异常' : workspace.status === 'disabled' ? '停用' : '接入中'}</Badge></Space><Title level={5}><Link to={workspacePath(workspace.id)}>{workspace.name}</Link></Title><Text type="secondary" className="small-text">{workspace.slug}</Text></div>,
    },
    {
      title: '监听仓库', dataIndex: 'repositories', width: 330,
      render: (repositories: WorkspaceRepositoryRecord[]) => repositories.length ? <Flex vertical gap={7}>{repositories.map(repo => (
        <Flex key={repo.id} align="center" gap={8} className="repository-cell">
          <span className="provider-chip">{providerIcon(repo.provider)}<span>{providerLabels[repo.provider]}</span></span>
          <Text code className="repository-key">{repo.repository_key}</Text>
          <Badge tone={repo.health_state === 'ready' ? 'ok' : repo.health_state === 'error' ? 'bad' : 'neutral'}>{repo.status === 'ready' ? '就绪' : repo.status === 'error' ? '检查失败' : '待接入'}</Badge>
        </Flex>
      ))}</Flex> : <Text type="secondary">尚未绑定仓库</Text>,
    },
    { title: '进行中', dataIndex: 'open_tasks', width: 90, render: value => <Text strong>{value}</Text> },
    { title: '配置版本', key: 'binding', width: 100, render: (_, workspace) => <Text type="secondary" className="mono-note">{workspace.source_bindings[0] ? `v${workspace.source_bindings[0].config_version}` : '未同步'}</Text> },
    { title: '最近更新', dataIndex: 'updated_at', width: 120, render: value => <Text type="secondary" className="small-text">{formatFullDate(value)}</Text> },
    {
      title: '操作', key: 'actions', width: 250,
      render: (_, workspace) => <Space size={4} wrap={false} className="workspace-actions">
        <Link to={workspacePath(workspace.id)}><Button size="small">进入</Button></Link>
        {canManage && <Button size="small" icon={<PlusOutlined />} disabled={workspace.status === 'disabled'} onClick={() => openAddRepository(workspace)}>加仓库</Button>}
        {canManage && <Button size="small" onClick={() => void openMembers(workspace)}>成员</Button>}
        {canManage && workspace.status !== 'disabled' && <Popconfirm title="停用工作区？" description="会停止轮询并撤回未开始的排期。" onConfirm={() => void disableWorkspace(workspace)}><Button size="small" danger>停用</Button></Popconfirm>}
      </Space>,
    },
  ];

  if (loading) return <LoadingState label="正在加载工作区与仓库配置…" />;
  if (error) return <ErrorState message={error.message} action={error.body.error.action} onRetry={reload} />;

  return (
    <div className="page-stack">
      <PageHeader eyebrow="CONTROL PLANE / REPOSITORIES" title="工作区与仓库" description="同一 DSH 实例可监听多个仓库；任务、批准、排期和执行按工作区隔离。"
        actions={<Space><Button icon={<SyncOutlined />} loading={working} onClick={() => void syncAll()}>同步全部</Button>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建工作区</Button>}</Space>} />

      <Row gutter={[12, 12]}>
        {[
          { label: '工作区', value: summary.total, icon: <ApartmentOutlined />, hint: '可访问的业务隔离空间' },
          { label: '已启用', value: summary.active, icon: <CheckCircleOutlined />, hint: '允许接收与执行任务' },
          { label: '接入中', value: summary.onboarding, icon: <SafetyCertificateOutlined />, hint: '等待权限检查或描述确认' },
          { label: '监听仓库', value: summary.repositories, icon: <DatabaseOutlined />, hint: '统一由 DSH Source 多实例接入' },
        ].map((item, index) => <Col xs={12} lg={6} key={item.label}><Card variant="borderless" className="metric-card"><Flex justify="space-between"><div><Flex align="center" gap={8}><span className="index-no">W.{String(index + 1).padStart(2, '0')}</span><Text type="secondary">{item.label}</Text></Flex><Statistic value={item.value} /><Text type="secondary" className="metric-hint">{item.hint}</Text></div><span className="metric-icon">{item.icon}</span></Flex></Card></Col>)}
      </Row>

      <Card variant="borderless">
        <Flex justify="space-between" align="center" gap={12} wrap className="table-toolbar">
          <Input.Search allowClear placeholder="搜索工作区、仓库或 Provider" value={search} onChange={event => setSearch(event.target.value)} style={{ width: 340 }} />
          <Space><Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button><Text type="secondary">{filtered.length} 个工作区</Text></Space>
        </Flex>
        {filtered.length ? <Table rowKey="id" columns={columns} dataSource={filtered} pagination={false} scroll={{ x: 1080 }} /> : <Empty description={workspaces.length ? '没有匹配的工作区' : '还没有工作区，先完成仓库接入'}>{canManage && <Button type="primary" onClick={openCreate}>新建工作区</Button>}</Empty>}
      </Card>

      <Modal open={open} width={760} title={mode === 'create' ? '接入新工作区' : '为工作区添加仓库'} onCancel={() => !working && setOpen(false)}
        footer={null} destroyOnHidden>
        <Steps current={step} className="workspace-steps" items={[
          { title: '仓库与权限', description: '只保存凭据引用' },
          { title: '确认描述', description: '描述决定语义路由' },
          { title: '同步启用', description: '写入 DSH Source' },
        ]} />
        {flowError && <Alert className="workspace-flow-alert" type={step === 1 ? 'warning' : 'error'} showIcon title={flowError} closable onClose={() => setFlowError('')} />}
        {step === 0 && <Form<RepositoryForm> form={repositoryForm} layout="vertical" onFinish={connectRepository} requiredMark={false}>
          {mode === 'create' && <><Divider titlePlacement="left">工作区</Divider><Row gutter={12}>
            <Col span={12}><Form.Item label="工作区名称" name="name" rules={[{ required: true }]}><Input placeholder="例如：支付平台" /></Form.Item></Col>
            <Col span={12}><Form.Item label="URL Slug" name="slug" rules={[{ required: true, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }]}><Input placeholder="payment-platform" /></Form.Item></Col>
          </Row><Form.Item label="工作区说明" name="workspace_description"><Input.TextArea rows={2} maxLength={1000} placeholder="说明这个工作区承载的业务边界" /></Form.Item></>}
          <Divider titlePlacement="left">仓库</Divider>
          <Row gutter={12}>
            <Col span={10}><Form.Item label="Provider" name="provider" rules={[{ required: true }]}><Select options={Object.entries(providerLabels).map(([value, label]) => ({ value, label }))} /></Form.Item></Col>
            <Col span={14}><Form.Item label="仓库标识" name="repository_key" rules={[{ required: true }]}><Input placeholder="owner/repository 或 Provider 项目 ID" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item label="API 地址" name="api_base_url"><Input placeholder="https://api.github.com" /></Form.Item></Col>
            <Col span={12}><Form.Item label="默认分支" name="default_branch" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Form.Item label="Web 地址" name="web_base_url" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://github.com/owner/repository" /></Form.Item>
          <Form.Item label="克隆地址" name="clone_url" rules={[{ required: true }]}><Input placeholder="https://github.com/owner/repository.git" /></Form.Item>
          <Form.Item label="凭据引用" name="credential_ref" extra="用于只读仓库发现，只填写 env:变量名或 file:受控路径；Git 推送凭据由 DSH 运行账户管理，不要粘贴 Token。">
            <Input placeholder="env:DSH_GITEA_TOKEN" />
          </Form.Item>
          <Flex gap={24} wrap>
            <Form.Item label="Issue / MR" name="observe_issues" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item label="变更请求" name="observe_change_requests" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item label="评论" name="observe_comments" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item label="CI" name="observe_ci" valuePropName="checked"><Switch /></Form.Item>
          </Flex>
          <Flex justify="flex-end" gap={8}><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={working}>创建、检查并生成描述</Button></Flex>
        </Form>}
        {step === 1 && <div className="workspace-description-step">
          <Alert type="info" showIcon title="描述只用于语义路由，不会绕过人工审批；README 和仓库内容会被视为不可信输入。" />
          {discovery && <Descriptions className="workspace-discovery" size="small" column={2} items={[
            { key: 'repo', label: '仓库', children: <Text code>{discovery.repository_key}</Text> },
            { key: 'branch', label: '默认分支', children: discovery.default_branch },
            { key: 'language', label: '主要语言', children: discovery.language ?? '未知' },
            { key: 'permissions', label: '权限', children: <Space><Tag color="green">读取</Tag><Tag color="green">推送</Tag><Tag color="green">变更请求</Tag></Space> },
          ]} />}
          <Form<DescriptionForm> form={descriptionForm} layout="vertical" onFinish={confirmDescription} requiredMark={false}>
            <Form.Item label="仓库业务描述" name="short_description" rules={[{ required: true, min: 20, max: 1200 }]}><Input.TextArea rows={5} showCount maxLength={1200} /></Form.Item>
            <Form.Item label="能力（逗号分隔）" name="capabilities" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
            <Form.Item label="路由关键词（至少 3 个）" name="routing_keywords" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
            <Row gutter={12}><Col span={16}><Form.Item label="明确排除的内容" name="exclusions"><Input.TextArea rows={2} /></Form.Item></Col><Col span={8}><Form.Item label="置信度" name="confidence"><InputNumber min={0} max={1} step={0.01} className="full-width" /></Form.Item></Col></Row>
            <Flex justify="space-between"><Button onClick={() => setStep(0)} disabled={working}>返回修改仓库</Button><Button type="primary" htmlType="submit" loading={working}>确认描述并同步</Button></Flex>
          </Form>
        </div>}
        {step === 2 && <Flex vertical align="center" className="workspace-sync-state" gap={14}><Progress type="circle" percent={100} size={76} /><Title level={4}>配置已同步</Title><Paragraph type="secondary">DSH 已保存最新工作区配置，并将在轮询隔离生效后开始接收任务。</Paragraph></Flex>}
      </Modal>

      <Modal open={Boolean(memberWorkspace)} title={`${memberWorkspace?.name ?? ''} · 成员权限`} width={560}
        footer={<Button onClick={() => setMemberWorkspace(null)}>关闭</Button>} onCancel={() => setMemberWorkspace(null)} destroyOnHidden>
        <Alert type="info" showIcon title="非管理员只能访问被明确加入的工作区；管理员自动拥有全部工作区权限。" />
        <Flex vertical gap={8} className="workspace-member-list">
          {members.map(member => <Flex key={member.id} align="center" gap={10} className="workspace-member-row">
            <span className="member-avatar">{member.name.slice(-2)}</span>
            <div className="workspace-member-copy"><Text strong>{member.name}</Text><Text type="secondary">{member.email} · {member.role_name}</Text></div>
            <Popconfirm title="移除该成员？" onConfirm={() => void removeMember(member.id)}><Button size="small" danger loading={memberSaving}>移除</Button></Popconfirm>
          </Flex>)}
        </Flex>
        <Divider titlePlacement="left">添加成员</Divider>
        <Space.Compact block>
          <Select className="full-width" value={memberToAdd} placeholder="选择可访问该工作区的成员"
            options={allUsers.filter(user => !members.some(member => member.id === user.id)).map(user => ({ value: user.id, label: `${user.name} · ${user.email}` }))}
            onChange={value => setMemberToAdd(value)} />
          <Button type="primary" disabled={!memberToAdd} loading={memberSaving} onClick={() => void addMember()}>添加</Button>
        </Space.Compact>
      </Modal>
    </div>
  );
}
