import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App as AntdApp, Button, Card, Form, Input, Space, Typography } from 'antd';
import { ArrowRightOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import type { LoginResponse } from '../../types/api';

const { Title, Paragraph, Text } = Typography;
interface InviteForm { password: string; confirm_password: string }

export function AcceptInvitePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<InviteForm>();
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get('token');
    if (value) setToken(value);
    if (location.hash) window.history.replaceState(null, '', location.pathname);
  }, [location.hash, location.pathname]);

  const submit = async (values: InviteForm) => {
    if (!token) return;
    setSaving(true);
    try {
      const result = await api<LoginResponse>('/api/auth/invitations/accept', {
        method: 'POST', body: JSON.stringify({ token, password: values.password }),
      }, false);
      applySession(result.token, result.user);
      message.success('账号已激活');
      navigate('/', { replace: true });
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '邀请激活失败');
    } finally { setSaving(false); }
  };

  return (
    <div className="auth-link-page">
      <Card variant="borderless" className="auth-link-card">
        <Space orientation="vertical" size={16} className="full-width">
          <Space className="login-brand"><span className="brand-symbol"><SafetyCertificateOutlined /></span><span>Gatehouse</span></Space>
          <div><Text className="page-eyebrow">ACCOUNT SETUP</Text><Title level={2}>设置登录密码</Title><Paragraph type="secondary">完成设置后，账号会立即激活并进入控制台。</Paragraph></div>
          {!token && <Alert type="error" showIcon title="邀请链接无效" description="请联系管理员重新签发邀请链接。" />}
          <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
            <Form.Item label="新密码" name="password" extra="至少 12 个字符，不能与邮箱相同。" rules={[{ required: true, min: 12, message: '密码至少 12 个字符' }]}><Input.Password size="large" prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
            <Form.Item label="确认密码" name="confirm_password" dependencies={['password']} rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')); } }),
            ]}><Input.Password size="large" prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
            <Button type="primary" size="large" block htmlType="submit" loading={saving} disabled={!token} iconPlacement="end" icon={<ArrowRightOutlined />}>激活并进入控制台</Button>
          </Form>
          <Link to="/login">返回登录</Link>
        </Space>
      </Card>
    </div>
  );
}
