import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App as AntdApp, Button, Card, Form, Input, Space, Typography } from 'antd';
import { ArrowRightOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api, ApiError } from '../../api/client';

const { Title, Paragraph, Text } = Typography;
interface ResetForm { password: string; confirm_password: string }

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<ResetForm>();
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get('token');
    if (value) setToken(value);
    if (location.hash) window.history.replaceState(null, '', location.pathname);
  }, [location.hash, location.pathname]);

  const submit = async (values: ResetForm) => {
    if (!token) return;
    setSaving(true);
    try {
      await api('/api/auth/password-reset/complete', { method: 'POST', body: JSON.stringify({ token, password: values.password }) }, false);
      message.success('密码已重置，请重新登录');
      navigate('/login', { replace: true });
    } catch (reason) {
      message.error(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '密码重置失败');
    } finally { setSaving(false); }
  };

  return (
    <div className="auth-link-page">
      <Card variant="borderless" className="auth-link-card">
        <Space orientation="vertical" size={16} className="full-width">
          <Space className="login-brand"><span className="brand-symbol"><SafetyCertificateOutlined /></span><span>Gatehouse</span></Space>
          <div><Text className="page-eyebrow">PASSWORD RESET</Text><Title level={2}>重置登录密码</Title><Paragraph type="secondary">设置新密码后，旧密码和现有会话会立即失效。</Paragraph></div>
          {!token && <Alert type="error" showIcon title="重置链接无效" description="请联系管理员重新签发密码重置链接。" />}
          <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
            <Form.Item label="新密码" name="password" extra="至少 12 个字符，不能与邮箱相同。" rules={[{ required: true, min: 12, message: '密码至少 12 个字符' }]}><Input.Password size="large" prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
            <Form.Item label="确认密码" name="confirm_password" dependencies={['password']} rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')); } }),
            ]}><Input.Password size="large" prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
            <Button type="primary" size="large" block htmlType="submit" loading={saving} disabled={!token} iconPlacement="end" icon={<ArrowRightOutlined />}>确认重置</Button>
          </Form>
          <Link to="/login">返回登录</Link>
        </Space>
      </Card>
    </div>
  );
}
