import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { WorkspaceProvider } from './hooks/useWorkspace';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#191817',
          colorInfo: '#191817',
          colorSuccess: '#2c7a4b',
          colorWarning: '#b5690a',
          colorError: '#c73325',
          colorBgLayout: '#f2f1ec',
          colorBgContainer: '#fdfdfa',
          colorBorderSecondary: '#ddd9cf',
          colorText: '#191817',
          colorTextSecondary: '#6b675e',
          borderRadius: 0,
          borderRadiusSM: 0,
          borderRadiusLG: 0,
          fontSize: 13,
          fontFamily: "'Archivo', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
          fontFamilyCode: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
        },
        components: {
          Button: { controlHeight: 36, fontWeight: 600, primaryShadow: 'none' },
          Card: { headerFontSize: 12, headerHeight: 46, paddingLG: 20 },
          Table: { headerBg: '#fdfdfa', headerColor: '#6b675e', cellPaddingBlock: 12, headerSplitColor: 'transparent' },
          Layout: { headerBg: '#fdfdfa', siderBg: '#141311', headerHeight: 58, headerPadding: '0 24px' },
          Menu: {
            darkItemBg: '#141311', darkSubMenuItemBg: '#141311', darkItemColor: '#8f8a80',
            darkItemHoverColor: '#f2f1ec', darkItemSelectedBg: '#141311', darkItemSelectedColor: '#f2f1ec',
            itemBorderRadius: 0,
          },
          Tabs: { horizontalMargin: '0', titleFontSize: 13 },
          Tag: { defaultBg: '#f2f1ec', defaultColor: '#6b675e' },
          Statistic: { contentFontSize: 30 },
          Descriptions: { titleMarginBottom: 12 },
          Modal: { titleFontSize: 15 },
          Alert: { borderRadiusLG: 0 },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <AuthProvider>
            <WorkspaceProvider><App /></WorkspaceProvider>
          </AuthProvider>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
