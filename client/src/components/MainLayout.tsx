import React from 'react';
import { Outlet } from 'react-router-dom';
import BottomNav from './BottomNav';

const MainLayout: React.FC = () => {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '428px',
    minWidth: '320px',
    margin: '0 auto',
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0f2f5 0%, #e8eaf0 100%)',
    position: 'relative',
    overflowX: 'hidden',
  },
  content: {
    paddingBottom: '60px',
    minHeight: 'calc(100vh - 60px)',
  },
};

export default MainLayout;
