import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, Drawer, Dropdown, Flex, Grid, Layout, Menu, Space, Typography } from 'antd';
import {
  AuditOutlined, BellOutlined, CalendarOutlined, ControlOutlined, DashboardOutlined, DownOutlined,
  LogoutOutlined, MenuOutlined, RocketOutlined, SafetyCertificateOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useApiData } from '../hooks/useApiData';
import { useAuth } from '../hooks/useAuth';
import { roleLabels } from '../lib/format';
import type { SettingsResponse } from '../types/api';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function navLabel(index: string, label: string) {
  return <span><span className="nav-index">{index}</span>{label}</span>;
}

const primaryItems = [
  { key: '/', icon: <DashboardOutlined />, label: navLabel('01', '工作台') },
  { key: '/review', icon: <AuditOutlined />, label: navLabel('02', '复核中心') },
  { key: '/schedule', icon: <CalendarOutlined />, label: navLabel('03', '执行调度') },
  { key: '/executions', icon: <RocketOutlined />, label: navLabel('04', '交付记录') },
  { key: '/audit', icon: <ControlOutlined />, label: navLabel('05', '审计日志') },
];
const settingsItem = { key: '/settings', icon: <SettingOutlined />, label: navLabel('06', '系统设置') };
const titles: Record<string, { title: string; section: string }> = {
  '/': { title: '工作台', section: '总览' }, '/review': { title: '复核中心', section: '人工决策' },
  '/schedule': { title: '执行调度', section: '排期控制' }, '/executions': { title: '交付记录', section: '执行结果' },
  '/audit': { title: '审计日志', section: '全链路追踪' }, '/settings': { title: '系统设置', section: '连接与权限' },
};

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const selected = location.pathname.startsWith('/review/') ? '/review' : location.pathname;
  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selected]}
      items={primaryItems}
      onClick={({ key }) => { navigate(key); onNavigate?.(); }}
      className="main-navigation"
    />
  );
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  return <Text className="header-clock">UTC+8 {text}</Text>;
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: workspaceSettings, loading: workspaceLoading } = useApiData<SettingsResponse>('/api/settings');
  const repositoryParts = workspaceSettings?.monitored_repository?.split('/');
  const repositoryOwner = repositoryParts?.[0] ?? '';
  const repositoryName = repositoryParts?.slice(1).join('/') ?? '';
  const routeInfo = location.pathname.startsWith('/review/')
    ? { title: '需求详情', section: '人工决策' }
    : titles[location.pathname] ?? { title: '复核中心', section: 'Gatehouse' };
  const userMenu = useMemo(() => ({
    items: [
      { key: 'email', label: user?.email ?? '', disabled: true },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: ({ key }: { key: string }) => { if (key === 'logout') { logout(); navigate('/login'); } },
  }), [logout, navigate, user?.email]);

  const sidebarContent = (
    <>
      <Flex className="brand" align="center" gap={10}>
        <span className="brand-symbol"><SafetyCertificateOutlined /></span>
        <span className="brand-wordmark"><strong>Gatehouse</strong><small>Agent Delivery Control</small></span>
      </Flex>
      <div className="workspace-card">
        <Text className="workspace-label">当前工作区</Text>
        <Flex align="flex-start" gap={8} className="workspace-repository" title={workspaceSettings?.monitored_repository ?? undefined}>
          <span className="workspace-mark">GH</span>
          <span className="workspace-repository-name">
            {workspaceSettings?.monitored_repository ? (
              <>
                <span>{repositoryOwner}/</span><strong>{repositoryName}</strong>
              </>
            ) : (
              <span className="workspace-repository-empty">{workspaceLoading ? '正在读取监听仓库…' : '未配置监听仓库'}</span>
            )}
          </span>
          <DownOutlined />
        </Flex>
      </div>
      <Text className="nav-caption">管理</Text>
      <Navigation onNavigate={() => setDrawerOpen(false)} />
      <div className="sidebar-system">
        <Text className="nav-caption">系统</Text>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={[settingsItem]} onClick={({ key }) => { navigate(key); setDrawerOpen(false); }} />
      </div>
      <div className="sidebar-bottom">
        <div className="runtime-status"><span className="lamp on" /><div><Text>控制面运行正常</Text><Text type="secondary">outbox 自动重试已启用</Text></div></div>
        <Flex align="center" gap={9} className="signed-user">
          <Avatar className="person-avatar">{user?.name?.slice(-2)}</Avatar>
          <div><Text strong>{user?.name}</Text><Text type="secondary">{user ? roleLabels[user.role] : ''}</Text></div>
          <Button type="text" className="logout-button" icon={<LogoutOutlined />} onClick={() => { logout(); navigate('/login'); }} />
        </Flex>
      </div>
    </>
  );

  return (
    <Layout className="app-layout">
      {screens.lg ? <Sider width={232} className="app-sider">{sidebarContent}</Sider> : null}
      <Drawer placement="left" size={252} closable={false} open={!screens.lg && drawerOpen} onClose={() => setDrawerOpen(false)} styles={{ body: { padding: 0, background: '#141311' } }}>
        <div className="app-sider drawer-sider">{sidebarContent}</div>
      </Drawer>
      <Layout>
        <Header className="app-header">
          <Flex align="center" gap={10}>
            {!screens.lg && <Button type="text" aria-label="打开导航" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />}
            <span className="header-crumb"><Text type="secondary">{routeInfo.section}</Text> <span className="header-divider">/</span> <Text strong>{routeInfo.title}</Text></span>
          </Flex>
          <Space size={16}>
            <HeaderClock />
            <Button type="text" icon={<BellOutlined />} aria-label="通知" />
            <Dropdown menu={userMenu} trigger={['click']} placement="bottomRight">
              <Button type="text" className="header-user"><Avatar size={26} className="person-avatar">{user?.name?.slice(-2)}</Avatar>{user?.name}<DownOutlined /></Button>
            </Dropdown>
          </Space>
        </Header>
        <Content className="app-content"><Outlet /></Content>
      </Layout>
    </Layout>
  );
}
