// Trap Chat — API Service
// Connects to Flask/SocketIO backend

import { io, Socket } from 'socket.io-client';
import {
  User,
  GuestSession,
  Game,
  Match,
  MatchmakingRequest,
  MatchmakingResponse,
  LeaderboardEntry,
  Room,
  GameResult,
  MatchSettings,
  WebRTCSignal,
  GameSlug,
  AuthState,
} from '../types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');

class ApiService {
  private socket: Socket | null = null;
  private authToken: string | null = null;
  private guestSessionId: string | null = null;

  // REST API helpers
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include', // Include cookies for JWT auth
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth
  async register(username: string, email: string | undefined, password: string): Promise<{ user: User }> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  async login(username: string, password: string): Promise<{ user: User }> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async guest(): Promise<GuestSession> {
    const result = await this.request<GuestSession>('/api/auth/guest', { method: 'POST' });
    this.guestSessionId = result.guest_session_id;
    return result;
  }

  async me(): Promise<{ user?: User; guest?: boolean; guest_session_id?: string }> {
    return this.request('/api/auth/me');
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST' });
    this.authToken = null;
    this.guestSessionId = null;
  }

  async updatePreferences(prefs: Partial<User['preferences']>): Promise<{ preferences: User['preferences'] }> {
    return this.request('/api/auth/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
  }

  async updateLocation(lat: number, lng: number): Promise<{ lat: number; lng: number }> {
    return this.request('/api/auth/location', {
      method: 'PUT',
      body: JSON.stringify({ lat, lng }),
    });
  }

  // Games
  async getGames(): Promise<Game[]> {
    return this.request('/api/games');
  }

  // Matchmaking
  async quickMatch(request: MatchmakingRequest): Promise<MatchmakingResponse> {
    return this.request('/api/matches/quick', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async createRoom(gameSlug: GameSlug, settings: MatchSettings): Promise<{ code: string; game: GameSlug; settings: MatchSettings }> {
    return this.request('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ game_slug: gameSlug, settings }),
    });
  }

  async listRooms(): Promise<Room[]> {
    return this.request('/api/rooms');
  }

  async joinRoom(code: string): Promise<{ match_id: number; room_code: string; game: GameSlug }> {
    return this.request(`/api/rooms/${code}/join`, { method: 'POST' });
  }

  // Match results
  async submitResult(matchId: number, result: GameResult): Promise<{ ok: boolean }> {
    return this.request(`/api/matches/${matchId}/submit`, {
      method: 'POST',
      body: JSON.stringify(result),
    });
  }

  async getLeaderboard(gameSlug: GameSlug): Promise<LeaderboardEntry[]> {
    return this.request(`/api/leaderboard/${gameSlug}`);
  }

  // Socket.IO
  connect(): Socket {
    if (this.socket?.connected) return this.socket;

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: true,
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected:', this.socket?.id);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    this.socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err);
    });

    return this.socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  // Socket event emitters
  joinMatch(matchId: number): void {
    this.socket?.emit('join_match', { match_id: matchId });
  }

  leaveMatch(matchId: number): void {
    this.socket?.emit('leave_match', { match_id: matchId });
  }

  sendGameAction(matchId: number, action: string, payload: Record<string, unknown>): void {
    this.socket?.emit('game_action', { match_id: matchId, action, payload });
  }

  sendSignal(signal: WebRTCSignal): void {
    this.socket?.emit('signal', signal);
  }

  sendChatMessage(matchId: number, text: string): void {
    this.socket?.emit('chat_message', { match_id: matchId, text });
  }

  // Socket event listeners (user provides callbacks)
  onMatchStart(cb: (data: { match_id: number; room_code: string; game: GameSlug }) => void): () => void {
    this.socket?.on('match_start', cb);
    return () => this.socket?.off('match_start', cb);
  }

  onMatchFinished(cb: (data: { match_id: number; results: { name: string; result: GameResult }[] }) => void): () => void {
    this.socket?.on('match_finished', cb);
    return () => this.socket?.off('match_finished', cb);
  }

  onPlayerJoined(cb: (data: { match_id: number; player: NonNullable<Match['players']>[number] }) => void): () => void {
    this.socket?.on('player_joined', cb);
    return () => this.socket?.off('player_joined', cb);
  }

  onPlayerLeft(cb: (data: { match_id: number; player_id: number }) => void): () => void {
    this.socket?.on('player_left', cb);
    return () => this.socket?.off('player_left', cb);
  }

  onSignal(cb: (signal: WebRTCSignal) => void): () => void {
    this.socket?.on('signal', cb);
    return () => this.socket?.off('signal', cb);
  }

  onChatMessage(cb: (data: { match_id: number; from: string; text: string; timestamp: string }) => void): () => void {
    this.socket?.on('chat_message', cb);
    return () => this.socket?.off('chat_message', cb);
  }

  onGameState(cb: (data: { match_id: number; state: Record<string, unknown> }) => void): () => void {
    this.socket?.on('game_state', cb);
    return () => this.socket?.off('game_state', cb);
  }

  onError(cb: (data: { message: string; code?: string }) => void): () => void {
    this.socket?.on('error', cb);
    return () => this.socket?.off('error', cb);
  }
}

export const api = new ApiService();
export default api;