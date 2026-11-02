import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorSuccess: '#16855b',
          colorWarning: '#c77a2b',
          colorError: '#c44747',
          colorBgLayout: '#f3f5f8',
          colorBorderSecondary: '#e7ebf0',
          borderRadius: 7,
          fontSize: 13,
          fontFamily: "'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Button: { controlHeight: 34, fontWeight: 500 },
          Card: { headerFontSize: 14 },
          Table: { headerBg: '#f7f8fa', headerColor: '#667085', cellPaddingBlock: 12 },
          Layout: { headerBg: '#ffffff', siderBg: '#101828' },
          Menu: { darkItemBg: '#101828', darkSubMenuItemBg: '#101828', darkItemSelectedBg: '#1f3a5f', itemBorderRadius: 6 },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
