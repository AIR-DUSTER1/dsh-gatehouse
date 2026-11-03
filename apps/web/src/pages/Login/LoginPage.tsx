import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Flex, Form, Input, Tag, Typography } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../api/client';

const { Title, Paragraph, Text } = Typography;
export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm<{ email: string; password: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (user) return <Navigate to="/" replace />;

  const submit = async (values: { email: string; password: string }) => {
    setLoading(true); setError('');
    try {
      await login(values.email, values.password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (reason) {
      setError(reason instanceof ApiError ? `${reason.body.error.message}。${reason.body.error.action}` : '登录失败，请稍后重试');
    } finally { setLoading(false); }
  };

  return (
    <div className="login-page">
      <section className="login-context">
        <Flex align="center" gap={10} className="login-brand"><span className="brand-symbol"><SafetyCertificateOutlined /></span><span>Gatehouse</span></Flex>
        <div className="login-message">
          <Tag>Human-in-the-loop</Tag>
          <Title>让 Agent 的执行<br />始终处于可控范围</Title>
          <Paragraph>集中处理 dsh-superagent 的调研提案、人工审批、持久化排期、执行回执与审计追踪。</Paragraph>
          <div className="login-principles">
            <span><CheckCircleOutlined />批准前不产生执行副作用</span>
            <span><CheckCircleOutlined />需求与执行范围哈希绑定</span>
            <span><CheckCircleOutlined />执行、交付与审计可追踪</span>
          </div>
        </div>
        <Text className="login-copyright">dsh-superagent Console · v0.1</Text>
      </section>

      <section className="login-auth">
        <Card className="login-card" variant="borderless">
          <div className="login-heading"><Text className="page-eyebrow">SIGN IN</Text><Title level={2}>登录控制台</Title><Paragraph type="secondary">使用项目成员账号继续。</Paragraph></div>
          {error && <Alert type="error" showIcon title={error} className="login-alert" />}
          <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item label="工作邮箱" name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
              <Input size="large" prefix={<MailOutlined />} placeholder="name@company.com" autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password size="large" prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" loading={loading} block iconPlacement="end" icon={<ArrowRightOutlined />}>进入控制台</Button>
          </Form>
        </Card>
      </section>
    </div>
  );
}
