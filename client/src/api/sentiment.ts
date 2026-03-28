import apiClient from './client';

export interface SentimentData {
  score: number | null;
  label?: string;
  emoji?: string;
  components?: {
    volumeRatio: number;
    shChangePercent: number;
    hs300ChangePercent: number;
  };
  updatedAt?: string;
  message?: string;
}

export async function getSentimentCurrent(): Promise<SentimentData> {
  const res = await apiClient.get<SentimentData>('/sentiment/current');
  return res.data;
}
