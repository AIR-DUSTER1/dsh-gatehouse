import { useState } from 'react';
import { App as AntdApp, Button, Card, Col, Form, Input, Row, Space, Typography } from 'antd';
import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { PageHeader } from '../../components/ui';
import type { LoginResponse } from '../../types/api';

const { Text, Title } = Typography;
interface PasswordForm { current_password: string; new_password: string; confirm_password: string }

export function AccountSecurityPage() {
  const { user, applySession } = useAuth();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<PasswordForm>();
  const [saving, setSaving] = useState(false);

  const submit = async (values: PasswordForm) => {
    setSaving(true);
    try {
      const result = await api<LoginResponse>('/api/auth/password/change', {
        method: 'POST', body: JSON.stringify({ current_password: values.current_password, new_password: values.new_password }),
      });
      applySession(result.token, result.user);
      form.resetFields();
      message.success('密码已更新，其他设备上的会话已失效');
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '密码修改失败');
    } finally { setSaving(false); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="ACCOUNT / SECURITY" title="账号安全" description="修改密码后，其他设备上的现有会话会立即失效。" />
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={14}>
          <Card variant="borderless" title={<Space><LockOutlined />修改密码</Space>}>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
              <Form.Item label="当前密码" name="current_password" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
              <Form.Item label="新密码" name="new_password" extra="至少 12 个字符，不能与邮箱相同。" rules={[{ required: true, min: 12, message: '新密码至少 12 个字符' }]}><Input.Password autoComplete="new-password" /></Form.Item>
              <Form.Item label="确认新密码" name="confirm_password" dependencies={['new_password']} rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('new_password') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')); } }),
              ]}><Input.Password autoComplete="new-password" /></Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>保存新密码</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card variant="borderless" title={<Space><SafetyCertificateOutlined />当前账号</Space>}>
            <Title level={4}>{user?.name}</Title>
            <Text type="secondary">{user?.email}</Text>
            <div className="security-facts">
              <span><strong>角色</strong><small>{user?.role_name}</small></span>
              <span><strong>最近登录</strong><small>{user?.last_login_at ? new Date(user.last_login_at).toLocaleString('zh-CN') : '尚未记录'}</small></span>
              <span><strong>密码更新时间</strong><small>{user?.password_changed_at ? new Date(user.password_changed_at).toLocaleString('zh-CN') : '尚未设置'}</small></span>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
