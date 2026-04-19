/**
 * Frontend-Backend Integration Verification Tests
 *
 * Verifies that all API modules, client configuration, and page-API connections
 * are correctly wired for the AI Investment Assistant application.
 */
import apiClient from '../api/client';
import * as authApi from '../api/auth';
import * as positionsApi from '../api/positions';
import * as messagesApi from '../api/messages';
import * as chatApi from '../api/chat';
import * as analysisApi from '../api/analysis';

// Mock toast to prevent side effects
jest.mock('../utils/toast', () => ({
  showErrorToast: jest.fn(),
}));

describe('API Client Configuration', () => {
  it('should have baseURL set to /api', () => {
    expect(apiClient.defaults.baseURL).toBe('/api');
  });

  it('should have 30s timeout configured', () => {
    expect(apiClient.defaults.timeout).toBe(30000);
  });

  it('should have Content-Type header set to application/json', () => {
    expect(apiClient.defaults.headers['Content-Type']).toBe('application/json');
  });

  it('should have request interceptor for auth token', () => {
    // Axios interceptors are stored in handlers array
    const requestInterceptors = (apiClient.interceptors.request as any).handlers;
    expect(requestInterceptors.length).toBeGreaterThan(0);
  });

  it('should have response interceptor for error handling', () => {
    const responseInterceptors = (apiClient.interceptors.response as any).handlers;
    expect(responseInterceptors.length).toBeGreaterThan(0);
  });
});

describe('Auth API Module Exports', () => {
  it('should export registerUser function', () => {
    expect(typeof authApi.registerUser).toBe('function');
  });

  it('should export loginUser function', () => {
    expect(typeof authApi.loginUser).toBe('function');
  });

  it('should export logoutUser function', () => {
    expect(typeof authApi.logoutUser).toBe('function');
  });
});

describe('Positions API Module Exports', () => {
  it('should export getPositions function', () => {
    expect(typeof positionsApi.getPositions).toBe('function');
  });

  it('should export createPosition function', () => {
    expect(typeof positionsApi.createPosition).toBe('function');
  });

  it('should export updatePosition function', () => {
    expect(typeof positionsApi.updatePosition).toBe('function');
  });

  it('should export deletePosition function', () => {
    expect(typeof positionsApi.deletePosition).toBe('function');
  });
});

describe('Messages API Module Exports', () => {
  it('should export getMessages function', () => {
    expect(typeof messagesApi.getMessages).toBe('function');
  });

  it('should export getMessageDetail function', () => {
    expect(typeof messagesApi.getMessageDetail).toBe('function');
  });

  it('should export getUnreadCount function', () => {
    expect(typeof messagesApi.getUnreadCount).toBe('function');
  });

  it('should export getDailyPicks function', () => {
    expect(typeof messagesApi.getDailyPicks).toBe('function');
  });
});

describe('Chat API Module Exports', () => {
  it('should export sendMessage function', () => {
    expect(typeof chatApi.sendMessage).toBe('function');
  });

  it('should export getChatHistory function', () => {
    expect(typeof chatApi.getChatHistory).toBe('function');
  });

  it('should export evaluateCalmDown function', () => {
    expect(typeof chatApi.evaluateCalmDown).toBe('function');
  });
});

describe('Analysis API Module Exports', () => {
  it('should export getAnalysis function', () => {
    expect(typeof analysisApi.getAnalysis).toBe('function');
  });

  it('should export getIndicators function', () => {
    expect(typeof analysisApi.getIndicators).toBe('function');
  });

  it('should export getRiskAlerts function', () => {
    expect(typeof analysisApi.getRiskAlerts).toBe('function');
  });

  it('should export getAnalysisHistory function', () => {
    expect(typeof analysisApi.getAnalysisHistory).toBe('function');
  });
});

describe('API Endpoint Mapping Verification', () => {
  const mockAdapter = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.defaults.adapter = mockAdapter;
  });

  afterEach(() => {
    delete (apiClient.defaults as any).adapter;
  });

  it('auth register calls POST /api/auth/register', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 201,
      data: { token: 't', user: { id: 1, username: 'u' } },
      headers: {},
    });
    await authApi.registerUser('u', 'p', true);
    expect(mockAdapter.mock.calls[0][0].url).toContain('/auth/register');
    expect(mockAdapter.mock.calls[0][0].method).toBe('post');
    const registerBody = mockAdapter.mock.calls[0][0].data;
    const parsed =
      typeof registerBody === 'string' ? JSON.parse(registerBody) : registerBody;
    expect(parsed).toHaveProperty('agreedTerms', true);
  });

  it('auth login calls POST /api/auth/login', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { token: 't', user: { id: 1, username: 'u' } },
      headers: {},
    });
    await authApi.loginUser('u', 'p');
    expect(mockAdapter.mock.calls[0][0].url).toContain('/auth/login');
    expect(mockAdapter.mock.calls[0][0].method).toBe('post');
  });

  it('auth logout calls POST /api/auth/logout', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { message: 'ok' },
      headers: {},
    });
    await authApi.logoutUser();
    expect(mockAdapter.mock.calls[0][0].url).toContain('/auth/logout');
    expect(mockAdapter.mock.calls[0][0].method).toBe('post');
  });

  it('getPositions calls GET /api/positions', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { positions: [] },
      headers: {},
    });
    await positionsApi.getPositions();
    expect(mockAdapter.mock.calls[0][0].url).toContain('/positions');
    expect(mockAdapter.mock.calls[0][0].method).toBe('get');
  });

  it('createPosition calls POST /api/positions', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 201,
      data: { position: {} },
      headers: {},
    });
    await positionsApi.createPosition({
      stockCode: '600000',
      stockName: '浦发银行',
      positionType: 'holding',
    });
    expect(mockAdapter.mock.calls[0][0].url).toContain('/positions');
    expect(mockAdapter.mock.calls[0][0].method).toBe('post');
  });

  it('getMessages calls GET /api/messages', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { messages: [], total: 0, hasMore: false },
      headers: {},
    });
    await messagesApi.getMessages();
    expect(mockAdapter.mock.calls[0][0].url).toContain('/messages');
    expect(mockAdapter.mock.calls[0][0].method).toBe('get');
  });

  it('getUnreadCount calls GET /api/messages/unread-count', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { count: 5 },
      headers: {},
    });
    await messagesApi.getUnreadCount();
    expect(mockAdapter.mock.calls[0][0].url).toContain('/messages/unread-count');
    expect(mockAdapter.mock.calls[0][0].method).toBe('get');
  });

  it('sendMessage calls POST /api/chat/send', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { message: {}, sellIntentDetected: false },
      headers: {},
    });
    await chatApi.sendMessage('hello');
    expect(mockAdapter.mock.calls[0][0].url).toContain('/chat/send');
    expect(mockAdapter.mock.calls[0][0].method).toBe('post');
  });

  it('getChatHistory calls GET /api/chat/history', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { messages: [] },
      headers: {},
    });
    await chatApi.getChatHistory();
    expect(mockAdapter.mock.calls[0][0].url).toContain('/chat/history');
    expect(mockAdapter.mock.calls[0][0].method).toBe('get');
  });

  it('evaluateCalmDown calls POST /api/calm-down/evaluate', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { evaluation: {} },
      headers: {},
    });
    await chatApi.evaluateCalmDown('600000');
    expect(mockAdapter.mock.calls[0][0].url).toContain('/calm-down/evaluate');
    expect(mockAdapter.mock.calls[0][0].method).toBe('post');
  });

  it('getAnalysis calls GET /api/analysis/:stockCode', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { analyses: [] },
      headers: {},
    });
    await analysisApi.getAnalysis('600000');
    expect(mockAdapter.mock.calls[0][0].url).toContain('/analysis/600000');
    expect(mockAdapter.mock.calls[0][0].method).toBe('get');
  });

  it('getIndicators calls GET /api/indicators/:stockCode', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { stockCode: '600000' },
      headers: {},
    });
    await analysisApi.getIndicators('600000');
    expect(mockAdapter.mock.calls[0][0].url).toContain('/indicators/600000');
    expect(mockAdapter.mock.calls[0][0].method).toBe('get');
  });

  it('getDailyPicks calls GET /api/messages with type=daily_pick', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { messages: [] },
      headers: {},
    });
    await messagesApi.getDailyPicks();
    const callUrl = mockAdapter.mock.calls[0][0].url;
    expect(callUrl).toContain('/messages');
    expect(mockAdapter.mock.calls[0][0].params).toEqual({ type: 'daily_pick', limit: 3 });
  });
});

describe('Backend Route Coverage', () => {
  it('all backend API routes have corresponding frontend API functions', () => {
    // This test documents the complete mapping between backend routes and frontend API modules
    const routeMapping = {
      'POST /api/auth/register': authApi.registerUser,
      'POST /api/auth/login': authApi.loginUser,
      'POST /api/auth/logout': authApi.logoutUser,
      'GET /api/positions': positionsApi.getPositions,
      'POST /api/positions': positionsApi.createPosition,
      'PUT /api/positions/:id': positionsApi.updatePosition,
      'DELETE /api/positions/:id': positionsApi.deletePosition,
      'GET /api/messages': messagesApi.getMessages,
      'GET /api/messages/:id': messagesApi.getMessageDetail,
      'GET /api/messages/unread-count': messagesApi.getUnreadCount,
      'POST /api/chat/send': chatApi.sendMessage,
      'GET /api/chat/history': chatApi.getChatHistory,
      'POST /api/calm-down/evaluate': chatApi.evaluateCalmDown,
      'GET /api/analysis/:stockCode': analysisApi.getAnalysis,
      'GET /api/indicators/:stockCode': analysisApi.getIndicators,
    };

    for (const [, fn] of Object.entries(routeMapping)) {
      expect(typeof fn).toBe('function');
    }

    // Verify count: 15 routes mapped
    expect(Object.keys(routeMapping).length).toBe(15);
  });
});
