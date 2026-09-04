// Trap Chat — Core Type Definitions

export interface User {
  id: number;
  username: string;
  email?: string;
  created_at: string;
  preferences: UserPreferences;
  lat?: number;
  lng?: number;
  rating: number;
}

export interface UserPreferences {
  game_filters?: string[];
  max_players?: number;
  local_radius_km?: number;
  notifications?: boolean;
  theme?: 'dark' | 'light' | 'system';
}

export interface GuestSession {
  guest_session_id: string;
  display_name: string;
}

export interface Game {
  id: number;
  slug: string;
  name: string;
  max_players: number;
  is_1v1: boolean;
  default_time_sec: number;
}

export type GameSlug = 
  | 'pushups' 
  | 'squats' 
  | 'rapbattle' 
  | 'symmetry' 
  | 'mog' 
  | 'textchat' 
  | 'ffa';

export interface Match {
  id: number;
  game_id: number;
  room_code: string;
  status: 'waiting' | 'active' | 'finished';
  host_user_id?: number;
  settings: MatchSettings;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  game?: Game;
  players?: MatchPlayer[];
}

export interface MatchSettings {
  time_limit_sec?: number;
  local_only?: boolean;
  rated?: boolean;
  max_players?: number;
}

export interface MatchPlayer {
  id: number;
  match_id: number;
  user_id?: number;
  guest_session_id?: string;
  display_name: string;
  joined_at: string;
  left_at?: string;
  result?: GameResult;
}

export interface GameResult {
  // Push-ups / Squats
  rep_count?: number;
  duration_sec?: number;
  // Rap Battle / Mog
  bars_text?: string;
  votes_received?: number;
  // Facial Symmetry
  symmetry_score?: number;
  // Common
  score?: number;
  [key: string]: unknown;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  achieved_at: string;
}

export interface Room {
  id: number;
  code: string;
  game_id: number;
  host_user_id?: number;
  settings: MatchSettings;
  status: 'open' | 'locked' | 'in_progress' | 'closed';
  created_at: string;
  game?: Game;
  player_count?: number;
}

export interface MatchmakingRequest {
  game_slug: GameSlug;
  local_only?: boolean;
  rated?: boolean;
}

export interface MatchmakingResponse {
  match_id: number;
  room_code: string;
  game: GameSlug;
  status: 'waiting' | 'active';
  players: { display_name: string }[];
}

export interface WebRTCSignal {
  type: 'offer' | 'answer' | 'candidate';
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  from: string;
  to: string;
  match_id: number;
}

export interface SocketEvents {
  // Client -> Server
  'join_match': { match_id: number };
  'leave_match': { match_id: number };
  'game_action': { match_id: number; action: string; payload: Record<string, unknown> };
  
  // Server -> Client
  'match_start': { match_id: number; room_code: string; game: GameSlug };
  'match_finished': { match_id: number; results: { name: string; result: GameResult }[] };
  'player_joined': { match_id: number; player: MatchPlayer };
  'player_left': { match_id: number; player_id: number };
  'signal': WebRTCSignal;
  'chat_message': { match_id: number; from: string; text: string; timestamp: string };
  'game_state': { match_id: number; state: Record<string, unknown> };
  'error': { message: string; code?: string };
}

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseDetectionResult {
  landmarks: PoseLandmark[];
  worldLandmarks?: PoseLandmark[];
  timestamp: number;
}

export interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export interface FaceDetectionResult {
  landmarks: FaceLandmark[];
  timestamp: number;
}

export interface RepCounterState {
  count: number;
  stage: 'up' | 'down' | 'transition';
  last_rep_time: number;
  angles: { left: number; right: number };
  form_issues: string[];
}

export interface SymmetryScore {
  score: number; // 0-100
  left_eye: { x: number; y: number };
  right_eye: { x: number; y: number };
  nose: { x: number; y: number };
  left_ear: { x: number; y: number };
  right_ear: { x: number; y: number };
}

export type AuthState = 
  | { status: 'authenticated'; user: User }
  | { status: 'guest'; session: GuestSession }
  | { status: 'unauthenticated' }
  | { status: 'loading' };

export type GameMode = 'chat' | 'competitive';

export interface LobbyTile {
  mode: GameMode;
  title: string;
  subtitle: string;
  icon: string;
  games?: GameSlug[];
}