import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import EventCalendar from './EventCalendar';
import * as eventsApi from '../api/events';

jest.mock('../api/events');

const mockGetEvents = eventsApi.getEvents as jest.MockedFunction<typeof eventsApi.getEvents>;

const mockEvents: eventsApi.CalendarEvent[] = [
  {
    id: 1,
    name: '全国两会',
    eventDate: '2027-03-03',
    eventEndDate: '2027-03-15',
    category: 'policy',
    relatedSectors: ['基建', '环保', '科技'],
    windowStatus: 'before_build',
    windowLabel: '事件前·可建仓',
    tip: '关注政策方向',
    beforeDays: 7,
    afterDays: 5,
  },
  {
    id: 2,
    name: '美联储议息会议',
    eventDate: '2027-03-18',
    eventEndDate: '2027-03-19',
    category: 'economic_data',
    relatedSectors: ['金融', '科技'],
    windowStatus: 'during_watch',
    windowLabel: '事件中·观望',
    tip: '关注利率决议',
    beforeDays: 3,
    afterDays: 2,
  },
  {
    id: 3,
    name: '中报披露期',
    eventDate: '2027-07-15',
    eventEndDate: '2027-08-31',
    category: 'financial_report',
    relatedSectors: ['全行业'],
    windowStatus: 'after_take_profit',
    windowLabel: '利好兑现·可减仓',
    tip: '关注业绩超预期个股',
    beforeDays: 10,
    afterDays: 5,
  },
];

describe('EventCalendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGetEvents.mockReturnValue(new Promise(() => {}));
    render(<EventCalendar />);
    expect(screen.getByTestId('event-loading')).toBeInTheDocument();
  });

  it('hides when API fails', async () => {
    mockGetEvents.mockRejectedValue(new Error('Network error'));
    const { container } = render(<EventCalendar />);
    await waitFor(() => {
      expect(screen.queryByTestId('event-loading')).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="event-calendar-card"]')).not.toBeInTheDocument();
  });

  it('renders card title with 7-day scope', async () => {
    mockGetEvents.mockResolvedValue(mockEvents);
    render(<EventCalendar />);
    await waitFor(() => {
      expect(screen.getByText('📅 事件日历（未来7天）')).toBeInTheDocument();
    });
  });

  it('shows empty state when no events', async () => {
    mockGetEvents.mockResolvedValue([]);
    render(<EventCalendar />);
    await waitFor(() => {
      expect(screen.getByTestId('event-empty')).toBeInTheDocument();
    });
  });

  it('renders all events with date prefix', async () => {
    mockGetEvents.mockResolvedValue(mockEvents);
    render(<EventCalendar />);
    await waitFor(() => {
      expect(screen.getByTestId('event-list')).toBeInTheDocument();
    });
    // Event names are prefixed with formatted date
    expect(screen.getByText(/全国两会/)).toBeInTheDocument();
    expect(screen.getByText(/美联储议息会议/)).toBeInTheDocument();
    expect(screen.getByText(/中报披露期/)).toBeInTheDocument();
  });

  it('shows window badges with emoji and label', async () => {
    mockGetEvents.mockResolvedValue(mockEvents);
    render(<EventCalendar />);
    await waitFor(() => {
      expect(screen.getByTestId('window-badge-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('window-badge-1').textContent).toContain('事件前·可建仓');
    expect(screen.getByTestId('window-badge-2').textContent).toContain('事件中·观望');
    expect(screen.getByTestId('window-badge-3').textContent).toContain('利好兑现·可减仓');
  });

  it('shows related sectors as inline text', async () => {
    mockGetEvents.mockResolvedValue(mockEvents);
    render(<EventCalendar />);
    await waitFor(() => {
      expect(screen.getByText(/关联：基建、环保、科技/)).toBeInTheDocument();
    });
    expect(screen.getByText(/关联：金融、科技/)).toBeInTheDocument();
  });

  it('shows tips with lightbulb emoji', async () => {
    mockGetEvents.mockResolvedValue(mockEvents);
    render(<EventCalendar />);
    await waitFor(() => {
      expect(screen.getByText(/💡 关注政策方向/)).toBeInTheDocument();
    });
    expect(screen.getByText(/💡 关注利率决议/)).toBeInTheDocument();
  });

  it('calls getEvents with days=7', async () => {
    mockGetEvents.mockResolvedValue([]);
    render(<EventCalendar />);
    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenCalledWith(7);
    });
  });
});
