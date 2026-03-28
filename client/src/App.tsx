import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import MainLayout from './components/MainLayout';

const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const PositionPage = React.lazy(() => import('./pages/PositionPage'));
const ChatPage = React.lazy(() => import('./pages/ChatPage'));
const MessageCenterPage = React.lazy(() => import('./pages/MessageCenterPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const OperationLogPage = React.lazy(() => import('./pages/OperationLogPage'));
const NotificationSettingsPage = React.lazy(() => import('./pages/NotificationSettingsPage'));
const AnalysisSettingsPage = React.lazy(() => import('./pages/AnalysisSettingsPage'));
const AboutPage = React.lazy(() => import('./pages/AboutPage'));
const DeepReportHistoryPage = React.lazy(() => import('./pages/DeepReportHistoryPage'));
const AccuracyStatsPage = React.lazy(() => import('./pages/AccuracyStatsPage'));
const TermsPage = React.lazy(() => import('./pages/TermsPage'));

function LoadingFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px', color: '#999', fontSize: '14px' }}>
      加载中...
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  // Check JWT expiry if token is a valid JWT format
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        return <Navigate to="/login" replace />;
      }
    }
  } catch {
    // If token can't be parsed, allow through (server will reject if invalid)
  }
  return <>{children}</>;
}

function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/position" element={<PositionPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/messages" element={<MessageCenterPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/oplog" element={<OperationLogPage />} />
          <Route path="/notification-settings" element={<NotificationSettingsPage />} />
          <Route path="/analysis-settings" element={<AnalysisSettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/analysis-history" element={<DeepReportHistoryPage />} />
          <Route path="/accuracy-stats" element={<AccuracyStatsPage />} />
          <Route path="/terms" element={<TermsPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
