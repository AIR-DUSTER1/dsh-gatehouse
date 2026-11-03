import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Divider, Flex, Form, Input, Tag, Typography } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../api/client';

const { Title, Paragraph, Text } = Typography;
const demoAccounts = [
  { name: '演示复核人', role: '复核人', email: 'li@example.com' },
  { name: '演示管理员', role: '管理员', email: 'zhao@example.com' },
  { name: '演示只读成员', role: '只读成员', email: 'wang@example.com' },
];

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
          <Form form={form} layout="vertical" initialValues={{ email: 'li@example.com', password: 'demo123' }} onFinish={submit} requiredMark={false}>
            <Form.Item label="工作邮箱" name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
              <Input size="large" prefix={<MailOutlined />} placeholder="name@company.com" autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password size="large" prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" loading={loading} block iconPlacement="end" icon={<ArrowRightOutlined />}>进入控制台</Button>
          </Form>
          <Divider plain><Text type="secondary">演示账号</Text></Divider>
          <Flex vertical gap={8}>
            {demoAccounts.map(account => (
              <Button key={account.email} className="demo-account-button" onClick={() => { form.setFieldsValue({ email: account.email, password: 'demo123' }); setError(''); }}>
                <span><strong>{account.name}</strong><Text type="secondary">{account.role}</Text></span><Text code>{account.email}</Text>
              </Button>
            ))}
          </Flex>
          <Text type="secondary" className="demo-password">统一密码：<Text code>demo123</Text></Text>
        </Card>
      </section>
    </div>
  );
}
