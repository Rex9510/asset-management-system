import apiClient from './client';

export interface CalendarEvent {
  id: number;
  name: string;
  eventDate: string;
  eventEndDate: string | null;
  category: string;
  relatedSectors: string[];
  windowStatus: 'before_build' | 'during_watch' | 'after_take_profit' | 'none';
  windowLabel: string;
  tip: string | null;
  beforeDays: number;
  afterDays: number;
}

export async function getEvents(days?: number): Promise<CalendarEvent[]> {
  const params = days ? `?days=${days}` : '';
  const res = await apiClient.get<{ events: CalendarEvent[] }>(`/events${params}`);
  return res.data.events;
}
