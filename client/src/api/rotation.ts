import apiClient from './client';

export interface RotationStatus {
  currentPhase: 'P1' | 'P2' | 'P3' | null;
  phaseLabel?: string;
  etfPerformance?: {
    tech: { code: string; change20d: number; volumeRatio: number };
    cycle: { code: string; change20d: number; volumeRatio: number };
    consumer: { code: string; change20d: number; volumeRatio: number };
  };
  previousPhase?: string | null;
  switchedAt?: string | null;
  updatedAt?: string;
  message?: string;
}

export async function getRotationCurrent(): Promise<RotationStatus> {
  const res = await apiClient.get<RotationStatus>('/rotation/current');
  return res.data;
}
