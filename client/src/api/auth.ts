import apiClient from './client';

export interface AuthResponse {
  token: string;
  user: { id: number; username: string };
}

export async function registerUser(username: string, password: string): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>('/auth/register', { username, password });
  return res.data;
}

export async function loginUser(username: string, password: string): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>('/auth/login', { username, password });
  return res.data;
}

export async function logoutUser(): Promise<void> {
  await apiClient.post('/auth/logout');
}
