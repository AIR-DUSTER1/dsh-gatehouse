import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, Drawer, Dropdown, Flex, Grid, Layout, Menu, Select, Space, Typography } from 'antd';
import {
  ApartmentOutlined, AuditOutlined, BarChartOutlined, BellOutlined, CalendarOutlined, ControlOutlined,
  DashboardOutlined, DownOutlined, GithubOutlined, GitlabOutlined, LogoutOutlined, MenuOutlined,
  RocketOutlined, SafetyCertificateOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace, workspacePath, workspaceSuffix } from '../hooks/useWorkspace';
import { roleLabels } from '../lib/format';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function navLabel(index: string, label: string) {
  return <span><span className="nav-index">{index}</span>{label}</span>;
}

function workspaceItems(workspaceId: string) {
  return [
    { key: workspacePath(workspaceId), icon: <DashboardOutlined />, label: navLabel('01', '工作台') },
    { key: workspacePath(workspaceId, 'review'), icon: <AuditOutlined />, label: navLabel('02', '复核中心') },
    { key: workspacePath(workspaceId, 'schedule'), icon: <CalendarOutlined />, label: navLabel('03', '执行调度') },
    { key: workspacePath(workspaceId, 'executions'), icon: <RocketOutlined />, label: navLabel('04', '交付记录') },
    { key: workspacePath(workspaceId, 'audit'), icon: <ControlOutlined />, label: navLabel('05', '审计日志') },
  ];
}

function globalItemsFor(role: string | undefined) {
  return [
    ...(role === 'admin' ? [{ key: '/analytics', icon: <BarChartOutlined />, label: navLabel('06', '全局统计') }] : []),
    { key: '/workspaces', icon: <ApartmentOutlined />, label: navLabel('07', '工作区') },
  ];
}
const settingsItem = { key: '/settings', icon: <SettingOutlined />, label: navLabel('08', '系统设置') };

const titles: Record<string, { title: string; section: string }> = {
  '': { title: '工作台', section: '当前工作区' },
  review: { title: '复核中心', section: '人工决策' },
  schedule: { title: '执行调度', section: '排期控制' },
  executions: { title: '交付记录', section: '执行结果' },
  audit: { title: '审计日志', section: '全链路追踪' },
};

function routeTitle(pathname: string) {
  if (pathname === '/analytics') return { title: '全局统计', section: '跨工作区总览' };
  if (pathname === '/workspaces') return { title: '工作区与仓库', section: '接入配置' };
  if (pathname === '/settings') return { title: '系统设置', section: '连接与权限' };
  if (pathname.includes('/review/')) return { title: '需求详情', section: '人工决策' };
  const suffix = workspaceSuffix(pathname).split('/')[0] ?? '';
  return titles[suffix] ?? { title: '工作区', section: 'Gatehouse' };
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentId, preferred } = useWorkspace();
  const suffix = workspaceSuffix(location.pathname);
  const navigationId = currentId ?? preferred?.id ?? null;
  const selected = currentId
    ? workspacePath(currentId, suffix.startsWith('review/') ? 'review' : suffix)
    : location.pathname;
  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selected]}
      items={navigationId ? workspaceItems(navigationId) : []}
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

function ProviderMark({ provider }: { provider: string }) {
  if (provider === 'github') return <GithubOutlined />;
  if (provider === 'gitlab') return <GitlabOutlined />;
  return <span className="provider-mark">{provider.slice(0, 2).toUpperCase()}</span>;
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { workspaces, current, preferred, currentId, loading } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const routeInfo = routeTitle(location.pathname);
  const suffix = workspaceSuffix(location.pathname);
  const shownWorkspace = current ?? preferred;
  const userMenu = useMemo(() => ({
    items: [
      { key: 'email', label: user?.email ?? '', disabled: true },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: ({ key }: { key: string }) => { if (key === 'logout') { logout(); navigate('/login'); } },
  }), [logout, navigate, user?.email]);

  const selectWorkspace = (nextId: string) => {
    const nextSuffix = currentId ? suffix : '';
    navigate(workspacePath(nextId, nextSuffix));
    setDrawerOpen(false);
  };

  const workspaceSelector = (
    <div className="workspace-card workspace-card--interactive">
      <Flex justify="space-between" align="center">
        <Text className="workspace-label">当前工作区</Text>
        <span className={`workspace-state workspace-state--${shownWorkspace?.status ?? 'onboarding'}`}>
          {shownWorkspace?.status === 'active' ? '运行中' : shownWorkspace?.status === 'error' ? '异常' : shownWorkspace?.status === 'disabled' ? '已停用' : '接入中'}
        </span>
      </Flex>
      <Select
        value={shownWorkspace?.id ?? null}
        loading={loading}
        disabled={!workspaces.length}
        showSearch
        optionFilterProp="search"
        placeholder={loading ? '读取工作区…' : '选择工作区'}
        onChange={selectWorkspace}
        popupMatchSelectWidth={300}
        className="workspace-select"
        options={workspaces.map((workspace) => ({
          value: workspace.id,
          search: `${workspace.name} ${workspace.slug} ${workspace.repositories.map((repo) => repo.repository_key).join(' ')}`,
          label: (
            <Flex align="center" gap={9} className="workspace-option">
              <span className={`workspace-dot workspace-dot--${workspace.status}`} />
              <span className="workspace-option-copy">
                <strong>{workspace.name}</strong>
                <small>{workspace.repositories[0]?.repository_key ?? '尚未绑定仓库'}</small>
              </span>
              {workspace.repositories[0] ? <ProviderMark provider={workspace.repositories[0].provider} /> : null}
            </Flex>
          ),
        }))}
        notFoundContent={<span className="workspace-empty-option">没有可访问的工作区</span>}
      />
      <Flex justify="space-between" align="center" className="workspace-card-meta">
        <Text type="secondary">{shownWorkspace
          ? `${shownWorkspace.repositories[0]?.repository_key ?? '尚未绑定仓库'}${shownWorkspace.repositories.length > 1 ? ` +${shownWorkspace.repositories.length - 1}` : ''} · ${shownWorkspace.open_tasks} 个进行中任务`
          : '请先创建工作区'}</Text>
        <Button type="link" size="small" onClick={() => { navigate('/workspaces'); setDrawerOpen(false); }}>管理</Button>
      </Flex>
    </div>
  );

  const sidebarContent = (
    <>
      <Flex className="brand" align="center" gap={10}>
        <span className="brand-symbol"><SafetyCertificateOutlined /></span>
        <span className="brand-wordmark"><strong>Gatehouse</strong><small>Agent Delivery Control</small></span>
      </Flex>
      {workspaceSelector}
      <Text className="nav-caption">当前工作区</Text>
      <Navigation onNavigate={() => setDrawerOpen(false)} />
      <div className="sidebar-system sidebar-global">
        <Text className="nav-caption">全局</Text>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={globalItemsFor(user?.role)}
          onClick={({ key }) => { navigate(key); setDrawerOpen(false); }} />
      </div>
      <div className="sidebar-system">
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={[settingsItem]}
          onClick={({ key }) => { navigate(key); setDrawerOpen(false); }} />
      </div>
      <div className="sidebar-bottom">
        <div className="runtime-status"><span className={`lamp ${current?.status === 'active' ? 'on' : 'idle'}`} /><div><Text>{current?.status === 'active' ? '当前工作区运行正常' : '工作区等待配置'}</Text><Text type="secondary">同步、授权与审计已隔离</Text></div></div>
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
      {screens.lg ? <Sider width={248} className="app-sider">{sidebarContent}</Sider> : null}
      <Drawer placement="left" size={268} closable={false} open={!screens.lg && drawerOpen} onClose={() => setDrawerOpen(false)}
        styles={{ body: { padding: 0, background: '#141311' } }}>
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
