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
    margin: '0 auto',
    minHeight: '100vh',
    background: '#f5f5f5',
    position: 'relative',
  },
  content: {
    paddingBottom: '56px',
  },
};

export default MainLayout;
