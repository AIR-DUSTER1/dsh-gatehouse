import { useEffect, useMemo, useState } from 'react';
import { App as AntdApp, Button, Card, Checkbox, Col, Empty, Flex, Form, Input, Modal, Row, Space, Tag, Typography } from 'antd';
import { ApartmentOutlined, LockOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons';
import type { PermissionCode, PermissionRecord } from '@gatehouse/contract';
import { api, ApiError } from '../../api/client';
import { useApiData } from '../../hooks/useApiData';
import { permissionLabels } from '../../lib/format';
import { ErrorState, LoadingState, PageHeader } from '../../components/ui';
import type { PermissionListResponse, RoleListResponse, RoleResponse } from '../../types/api';

const { Text } = Typography;
interface CreateRoleForm { code: string; name: string; description?: string; permissions: PermissionCode[] }

export function RolesPage() {
  const { message } = AntdApp.useApp();
  const rolesState = useApiData<RoleListResponse>('/api/roles');
  const permissionsState = useApiData<PermissionListResponse>('/api/permissions');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionCode[]>([]);
  const [working, setWorking] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<CreateRoleForm>();
  const roles = rolesState.data?.items ?? [];
  const catalog = permissionsState.data?.items ?? [];
  const selected = useMemo(() => roles.find((role) => role.id === selectedId) ?? roles[0] ?? null, [roles, selectedId]);
  const grouped = useMemo(() => {
    const map = new Map<string, PermissionRecord[]>();
    for (const permission of catalog) {
      const list = map.get(permission.group_key) ?? [];
      list.push(permission);
      map.set(permission.group_key, list);
    }
    return [...map.entries()];
  }, [catalog]);

  useEffect(() => { if (!selectedId && roles[0]) setSelectedId(roles[0].id); }, [roles, selectedId]);
  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setDescription(selected.description);
    setPermissions(selected.permissions);
  }, [selected]);

  if (rolesState.loading || permissionsState.loading) return <LoadingState label="正在读取角色与权限目录…" />;
  if (rolesState.error || permissionsState.error || !rolesState.data || !permissionsState.data) {
    return <ErrorState message={rolesState.error?.body.error.message ?? permissionsState.error?.body.error.message ?? '角色加载失败'} onRetry={() => { rolesState.reload(); permissionsState.reload(); }} />;
  }

  const save = async () => {
    if (!selected || !selected.editable) return;
    setWorking(true);
    try {
      await api<RoleResponse>(`/api/roles/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ name, description, permissions }) });
      message.success('角色权限已更新');
      rolesState.reload();
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '保存失败');
    } finally { setWorking(false); }
  };

  const createRole = async () => {
    const values = await createForm.validateFields();
    setWorking(true);
    try {
      await api<RoleResponse>('/api/roles', { method: 'POST', body: JSON.stringify(values) });
      message.success('自定义角色已创建');
      setCreateOpen(false);
      createForm.resetFields();
      rolesState.reload();
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '创建失败');
    } finally { setWorking(false); }
  };

  const archive = async () => {
    if (!selected) return;
    setWorking(true);
    try {
      await api(`/api/roles/${selected.id}/archive`, { method: 'POST', body: '{}' });
      message.success('角色已停用');
      setSelectedId(null);
      rolesState.reload();
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '停用失败');
    } finally { setWorking(false); }
  };
  return (
    <div className="page-stack">
      <PageHeader eyebrow="ACCESS / ROLES" title="角色管理" description="维护角色与权限矩阵。管理员角色始终拥有完整权限且不可修改。"
        actions={<Space><Button href="/access/users">用户管理</Button><Button icon={<ReloadOutlined />} onClick={rolesState.reload}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建角色</Button></Space>} />
      <Row gutter={[14, 14]} align="stretch">
        <Col xs={24} lg={8}>
          <Card variant="borderless" title="角色列表" extra={<Tag>{roles.length}</Tag>} className="role-list-card">
            <div className="role-list">
              {roles.map((role) => <button key={role.id} type="button" className={`role-list-item ${selected?.id === role.id ? 'is-active' : ''}`} onClick={() => setSelectedId(role.id)}>
                <span className="role-list-icon">{role.code === 'admin' ? <LockOutlined /> : <SafetyCertificateOutlined />}</span>
                <span className="role-list-copy"><strong>{role.name}</strong><small>{role.code} · {role.user_count} 人</small></span>
                {role.is_system && <Tag>内置</Tag>}
              </button>)}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          {!selected ? <Card variant="borderless"><Empty description="请选择角色" /></Card> : (
            <Card variant="borderless" title={<Space><ApartmentOutlined />{selected.name}<Tag color={selected.status === 'active' ? 'green' : 'default'}>{selected.status === 'active' ? '启用' : '已停用'}</Tag></Space>}
              extra={<Space><Button danger disabled={selected.is_system || selected.user_count > 0} onClick={() => Modal.confirm({ title: '停用该角色？', content: '停用后不能再分配给用户。', onOk: () => void archive() })}>停用角色</Button><Button type="primary" icon={<SaveOutlined />} loading={working} disabled={!selected.editable} onClick={() => void save()}>保存权限</Button></Space>}>
              <Form layout="vertical" requiredMark={false}>
                <Row gutter={12}>
                  <Col xs={24} md={12}><Form.Item label="角色名称"><Input value={name} disabled={!selected.editable} onChange={(event) => setName(event.target.value)} /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item label="角色代码"><Input value={selected.code} disabled /></Form.Item></Col>
                </Row>
                <Form.Item label="说明"><Input.TextArea rows={2} value={description} disabled={!selected.editable} onChange={(event) => setDescription(event.target.value)} /></Form.Item>
              </Form>
              {!selected.editable && <div className="role-protected-note"><LockOutlined /> 管理员角色拥有完整权限，不能被编辑或停用。</div>}
              <div className="permission-groups">
                {grouped.map(([group, items]) => <section key={group} className="permission-group">
                  <div className="permission-group-head"><Text strong>{group}</Text><Text type="secondary">{items.length} 项</Text></div>
                  <div className="permission-grid">
                    {items.filter((permission) => selected.code === 'admin' || !permission.admin_only).map((permission) => <label key={permission.code} className={`permission-option ${!selected.editable ? 'is-disabled' : ''}`}>
                      <Checkbox disabled={!selected.editable} checked={permissions.includes(permission.code)}
                        onChange={(event) => setPermissions((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))} />
                      <span><strong>{permission.name}</strong><small>{permissionLabels[permission.code]} · {permission.code}</small></span>
                    </label>)}
                  </div>
                </section>)}
              </div>
            </Card>
          )}
        </Col>
      </Row>

      <Modal open={createOpen} title="新建自定义角色" width={680} destroyOnHidden forceRender onCancel={() => setCreateOpen(false)}
        onOk={() => void createRole()} confirmLoading={working} okText="创建角色">
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item label="角色名称" name="name" rules={[{ required: true, message: '请输入角色名称' }]}><Input maxLength={80} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item label="角色代码" name="code" rules={[{ required: true, pattern: /^[a-z][a-z0-9_-]{2,31}$/, message: '使用 3-32 位小写字母、数字、下划线或短横线' }]}><Input placeholder="release-reviewer" /></Form.Item></Col>
          </Row>
          <Form.Item label="说明" name="description"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
          <Form.Item label="权限" name="permissions" rules={[{ required: true, message: '至少选择一项权限' }]}>
            <Checkbox.Group className="permission-create-grid" options={catalog.filter((permission) => !permission.admin_only).map((permission) => ({ value: permission.code, label: `${permission.name} · ${permission.code}` }))} />
          </Form.Item>
          <Text type="secondary">管理员保留权限不会出现在自定义角色选项中。权限保存后，已分配用户下一次请求立即生效。</Text>
        </Form>
      </Modal>
    </div>
  );
}
