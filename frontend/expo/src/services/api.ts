// Trap Chat — API Service
// Connects to the public Flask/Socket.IO backend.

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
} from '../types';

// What /api/rooms actually returns when browsing, which is not the Room
// database row: it carries occupancy and a display name.
// A judged battle is settled by the room, so the tally is part of the state
// the screen renders, not an afterthought on the result.
export interface VoteRow {
  player_id: number;
  display_name: string;
  votes: number;
}

export interface VoteState {
  match_id: number;
  tally: VoteRow[];
  my_vote: number | null;
}

// What the server knows about a queue, so the screen can state it rather than
// infer it from nothing having happened yet.
export interface QueueState {
  game: string;
  game_name: string;
  others_waiting: number;
  you_are_waiting: boolean;
}

export interface SocialRoom {
  code: string;
  name: string;
  game: GameSlug;
  game_name: string;
  player_count: number;
  max_players: number;
  players: { display_name: string }[];
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || API_BASE;

function backendUrl(value: string | undefined, variableName: string): string {
  if (!value || value === 'https://YOUR_BACKEND_HOST') {
    throw new Error(`${variableName} is not configured for this build`);
  }
  return value.replace(/\/$/, '');
}

// Credentials are kept client-side, not only in cookies. The frontend and
// backend are on different sites, so every cookie the backend sets is a
// third-party cookie: Chrome incognito drops it outright and Safari and
// Firefox restrict it, which made guests fail with "guest session required".
const TOKEN_KEY = 'trapchat.token';
const GUEST_KEY = 'trapchat.guest';

function loadStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function saveStored(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, native). Fall back to memory only.
  }
}

class ApiService {
  private socket: Socket | null = null;
  // The match this client believes it is in, queued or active. Kept so a
  // reconnect can put it back in the room it was broadcast to.
  private currentMatchId: number | null = null;
  private authToken: string | null = loadStored(TOKEN_KEY);
  private guestSessionId: string | null = loadStored(GUEST_KEY);

  private setToken(token: string | null): void {
    this.authToken = token;
    saveStored(TOKEN_KEY, token);
  }

  private setGuestSession(id: string | null): void {
    this.guestSessionId = id;
    saveStored(GUEST_KEY, id);
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      // A signed-in user wins; otherwise fall back to the guest session.
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      ...(!this.authToken && this.guestSessionId ? { 'X-Guest-Session': this.guestSessionId } : {}),
      ...options.headers,
    };
    const response = await fetch(`${backendUrl(API_BASE, 'EXPO_PUBLIC_API_URL')}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async register(username: string, email: string | undefined, password: string): Promise<{ user: User }> {
    const result = await this.request<{ user: User; token?: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    if (result.token) this.setToken(result.token);
    this.setGuestSession(null);
    return result;
  }

  async login(username: string, password: string): Promise<{ user: User }> {
    const result = await this.request<{ user: User; token?: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (result.token) this.setToken(result.token);
    this.setGuestSession(null);
    return result;
  }

  async guest(displayName?: string): Promise<GuestSession> {
    // Sign out of any account first. login() clears the guest session, so this
    // has to clear the token to match: without it a stored token still won
    // every request, "Continue as guest" quietly left you signed in as your
    // account, and a second tab that looked like a guest was really the same
    // person -- which cannot be matched against itself.
    this.setToken(null);
    const result = await this.request<GuestSession>('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ display_name: displayName ?? '' }),
    });
    this.setGuestSession(result.guest_session_id);
    return result;
  }

  async me(): Promise<{ user?: User; guest?: boolean; guest_session_id?: string }> {
    return this.request('/api/auth/me');
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST' });
    this.setToken(null);
    this.setGuestSession(null);
  }

  async updatePreferences(prefs: Partial<User['preferences']>): Promise<{ preferences: User['preferences'] }> {
    return this.request('/api/auth/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
  }

  async updateLocation(lat: number, lng: number): Promise<{ lat: number; lng: number }> {
    return this.request('/api/auth/location', { method: 'PUT', body: JSON.stringify({ lat, lng }) });
  }

  async getGames(): Promise<Game[]> {
    return this.request('/api/games');
  }

  async quickMatch(request: MatchmakingRequest): Promise<MatchmakingResponse> {
    return this.request('/api/matches/quick', { method: 'POST', body: JSON.stringify(request) });
  }

  async createRoom(gameSlug: GameSlug, settings: MatchSettings, name?: string): Promise<{ code: string; name: string; game: GameSlug; settings: MatchSettings }> {
    return this.request('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ game_slug: gameSlug, settings, name: name ?? '' }),
    });
  }

  async listRooms(): Promise<SocialRoom[]> {
    return this.request('/api/rooms');
  }

  async joinRoom(code: string): Promise<{ match_id: number; room_code: string; game: GameSlug; name?: string; game_name?: string }> {
    return this.request(`/api/rooms/${code}/join`, { method: 'POST' });
  }

  async submitResult(matchId: number, result: GameResult): Promise<{ ok: boolean }> {
    return this.request(`/api/matches/${matchId}/submit`, { method: 'POST', body: JSON.stringify(result) });
  }

  async getQueue(gameSlug: GameSlug): Promise<QueueState> {
    return this.request(`/api/games/${gameSlug}/queue`);
  }

  async getVotes(matchId: number): Promise<VoteState> {
    return this.request(`/api/matches/${matchId}/votes`);
  }

  async castVote(matchId: number, forPlayerId: number): Promise<VoteState> {
    return this.request(`/api/matches/${matchId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ for_player_id: forPlayerId }),
    });
  }

  async getLeaderboard(gameSlug: GameSlug): Promise<LeaderboardEntry[]> {
    return this.request(`/api/leaderboard/${gameSlug}`);
  }

  connect(): Socket {
    if (this.socket?.connected) return this.socket;
    this.socket = io(backendUrl(SOCKET_URL, 'EXPO_PUBLIC_SOCKET_URL'), {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: true,
      // The handshake cookie is third-party and often dropped, so send the
      // credentials explicitly. The server reads these on connect.
      auth: {
        token: this.authToken ?? undefined,
        guest_session: this.guestSessionId ?? undefined,
      },
    });
    this.socket.on('connect', () => {
      console.log('[Socket] Connected:', this.socket?.id);
      // A reconnect gets a new session id, and room membership is per session.
      // Without re-joining, match_start is broadcast to a room this client is
      // no longer in and it waits forever.
      if (this.currentMatchId != null) {
        this.socket?.emit('join_match', { match_id: this.currentMatchId });
      }
    });
    this.socket.on('disconnect', (reason) => console.log('[Socket] Disconnected:', reason));
    this.socket.on('connect_error', (err) => console.error('[Socket] Connection error:', err));
    return this.socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  // The server identifies a socket from the credentials sent on its handshake,
  // and those are fixed when the connection opens. A socket opened before
  // sign-in stays anonymous for its whole life, and every join_match on it is
  // rejected with "not a player in this match". Reconnect after the session
  // changes so the new handshake carries the current credentials.
  reconnect(): Socket {
    this.disconnect();
    return this.connect();
  }

  getSocket(): Socket | null { return this.socket; }
  joinMatch(matchId: number): void {
    this.currentMatchId = matchId;
    this.socket?.emit('join_match', { match_id: matchId });
  }

  leaveMatch(matchId: number): void {
    if (this.currentMatchId === matchId) this.currentMatchId = null;
    this.socket?.emit('leave_match', { match_id: matchId });
  }

  /** Stop claiming a match without leaving it, for cancelling a search. */
  forgetMatch(): void {
    this.currentMatchId = null;
  }
  sendGameAction(matchId: number, action: string, payload: Record<string, unknown>): void { this.socket?.emit('game_action', { match_id: matchId, action, payload }); }
  sendSignal(signal: WebRTCSignal): void { this.socket?.emit('signal', signal); }
  sendChatMessage(matchId: number, text: string): void { this.socket?.emit('chat_message', { match_id: matchId, text }); }
  onMatchStart(cb: (data: { match_id: number; room_code: string; game: GameSlug }) => void): () => void { this.socket?.on('match_start', cb); return () => this.socket?.off('match_start', cb); }
  onMatchFinished(cb: (data: { match_id: number; results: { name: string; result: GameResult }[] }) => void): () => void { this.socket?.on('match_finished', cb); return () => this.socket?.off('match_finished', cb); }
  onPlayerJoined(cb: (data: { match_id: number; player: NonNullable<Match['players']>[number] }) => void): () => void { this.socket?.on('player_joined', cb); return () => this.socket?.off('player_joined', cb); }
  onPlayerLeft(cb: (data: { match_id: number; player_id: number }) => void): () => void { this.socket?.on('player_left', cb); return () => this.socket?.off('player_left', cb); }
  onSignal(cb: (signal: WebRTCSignal) => void): () => void { this.socket?.on('signal', cb); return () => this.socket?.off('signal', cb); }
  onChatMessage(cb: (data: { match_id: number; from: string; text: string; timestamp: string }) => void): () => void { this.socket?.on('chat_message', cb); return () => this.socket?.off('chat_message', cb); }
  // The backend relays game actions back out on 'game_action', not 'game_state'.
  // Listening on 'game_state' silently never fires.
  onGameAction(cb: (data: { match_id: number; action: string; payload: Record<string, unknown>; from: string }) => void): () => void { this.socket?.on('game_action', cb); return () => this.socket?.off('game_action', cb); }
  onVoteUpdate(cb: (data: { match_id: number; tally: VoteRow[] }) => void): () => void { this.socket?.on('vote_update', cb); return () => this.socket?.off('vote_update', cb); }
  onError(cb: (data: { message: string; code?: string }) => void): () => void { this.socket?.on('error', cb); return () => this.socket?.off('error', cb); }
}

export const api = new ApiService();
export default api;
