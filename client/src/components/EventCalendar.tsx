import React, { useEffect, useState } from 'react';
import { getEvents, CalendarEvent } from '../api/events';

const windowStyles: Record<string, { bg: string; color: string; emoji: string; label: string }> = {
  before_build: { bg: 'rgba(46,213,115,0.1)', color: '#2ed573', emoji: '📥', label: '事件前·可建仓' },
  during_watch: { bg: 'rgba(255,165,2,0.1)', color: '#ffa502', emoji: '⏳', label: '事件中·观望' },
  after_take_profit: { bg: 'rgba(255,71,87,0.1)', color: '#ff4757', emoji: '📤', label: '利好兑现·可减仓' },
};

const tipColors: Record<string, string> = {
  before_build: '#2ed573',
  during_watch: '#e6960a',
  after_take_profit: '#ff4757',
};

const EventCalendar: React.FC = () => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getEvents(7)
      .then((res) => {
        if (!cancelled) {
          // 过滤掉已结束的事件（eventEndDate < today）
          const todayStr = new Date().toISOString().slice(0, 10);
          const filtered = res.filter((evt) => {
            const endDate = evt.eventEndDate || evt.eventDate;
            return endDate >= todayStr;
          });
          setEvents(filtered);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (error) return null;

  return (
    <div style={styles.card} data-testid="event-calendar-card">
      <div style={styles.title}>📅 事件日历（未来7天）</div>
      {loading ? (
        <div style={styles.skeleton} data-testid="event-loading">
          <div style={styles.skeletonBar} />
          <div style={{ ...styles.skeletonBar, width: '70%', marginTop: '8px' }} />
        </div>
      ) : events.length === 0 ? (
        <div style={styles.empty} data-testid="event-empty">
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>📅</div>
          <div style={{ fontSize: '14px', color: '#999' }}>暂无近期事件</div>
        </div>
      ) : (
        <div style={styles.list} data-testid="event-list">
          {events.map((evt, idx) => (
            <EventItem key={evt.id} event={evt} isLast={idx === events.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const formatDate = (dateStr: string): string => {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return dateStr;
  }
};

/**
 * 对于长期事件（跨多天），显示更合理的日期文本：
 * - 如果事件开始日期已过且还在进行中，显示"进行中·至X月X日"
 * - 如果事件即将开始，显示开始日期
 * - 如果是单日事件，显示该日期
 */
const formatEventDateDisplay = (event: CalendarEvent): string => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const startDate = event.eventDate;
  const endDate = event.eventEndDate || event.eventDate;

  if (startDate === endDate) {
    return formatDate(startDate);
  }

  // 长期事件
  if (startDate <= todayStr && endDate >= todayStr) {
    // 正在进行中
    return `进行中·至${formatDate(endDate)}`;
  }
  if (startDate > todayStr) {
    // 还没开始
    return `${formatDate(startDate)}-${formatDate(endDate)}`;
  }
  return formatDate(startDate);
};

const EventItem: React.FC<{ event: CalendarEvent; isLast: boolean }> = ({ event, isLast }) => {
  const ws = windowStyles[event.windowStatus];
  const tipColor = tipColors[event.windowStatus] || '#999';
  const dateStr = formatEventDateDisplay(event);

  return (
    <div
      style={{
        ...styles.item,
        borderBottom: isLast ? 'none' : '1px solid #f0f0f0',
      }}
      data-testid={`event-item-${event.id}`}
    >
      <div style={styles.itemHeader}>
        <span style={styles.eventName}>{dateStr} · {event.name}</span>
        {ws && (
          <span
            style={{
              ...styles.windowBadge,
              background: ws.bg,
              color: ws.color,
            }}
            data-testid={`window-badge-${event.id}`}
          >
            {ws.emoji} {ws.label}
          </span>
        )}
      </div>
      {event.relatedSectors.length > 0 && (
        <div style={styles.sectors}>
          关联：{event.relatedSectors.join('、')}
        </div>
      )}
      {event.tip && (
        <div style={{ ...styles.tip, color: tipColor }}>
          💡 {event.tip}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  title: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#333',
    marginBottom: '12px',
  },
  skeleton: {
    padding: '8px 0',
  },
  skeletonBar: {
    height: '16px',
    borderRadius: '8px',
    background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
    backgroundSize: '200% 100%',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '20px 0',
  },
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  item: {
    padding: '10px 0',
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
    gap: '8px',
  },
  eventName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#333',
    flex: 1,
    minWidth: 0,
  },
  windowBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '8px',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  sectors: {
    fontSize: '11px',
    color: '#999',
  },
  tip: {
    fontSize: '11px',
    marginTop: '3px',
    lineHeight: '16px',
  },
};

export default EventCalendar;
