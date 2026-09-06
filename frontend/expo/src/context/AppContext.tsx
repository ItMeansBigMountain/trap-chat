// Trap Chat — Auth & Match Context Provider

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import api from '../services/api';
import { User, AuthState, Match, GameResult, GameSlug, GuestSession } from '../types';

// ── State ─────────────────────────────────────────────────────────
interface AppState {
  auth: AuthState;
  games: import('../types').Game[];
  currentMatch: Match | null;
  isSearching: boolean;
  searchGame: GameSlug | null;
  location: { lat: number; lng: number } | null;
  // Which shape of social chat "Random" should look for next.
  socialMode: 'chat1v1' | 'groupchat';
}

const initialState: AppState = {
  auth: { status: 'loading' },
  games: [],
  currentMatch: null,
  isSearching: false,
  searchGame: null,
  location: null,
  socialMode: 'chat1v1',
};

// ── Actions ───────────────────────────────────────────────────────
type Action =
  | { type: 'SET_AUTH'; payload: AuthState }
  | { type: 'SET_GAMES'; payload: import('../types').Game[] }
  | { type: 'SET_MATCH'; payload: Match | null }
  | { type: 'SET_SEARCHING'; payload: { isSearching: boolean; game: GameSlug | null } }
  | { type: 'SET_LOCATION'; payload: { lat: number; lng: number } }
  | { type: 'SET_SOCIAL_MODE'; payload: AppState['socialMode'] }
  | { type: 'LOGOUT' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_AUTH':
      return { ...state, auth: action.payload };
    case 'SET_GAMES':
      return { ...state, games: action.payload };
    case 'SET_MATCH':
      return { ...state, currentMatch: action.payload };
    case 'SET_SEARCHING':
      return { ...state, isSearching: action.payload.isSearching, searchGame: action.payload.game };
    case 'SET_LOCATION':
      return { ...state, location: action.payload };
    case 'SET_SOCIAL_MODE':
      return { ...state, socialMode: action.payload };
    case 'LOGOUT':
      return { ...state, auth: { status: 'unauthenticated' }, currentMatch: null };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────
interface AppContextValue {
  state: AppState;
  // Auth
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string | undefined, password: string) => Promise<void>;
  guest: (displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  // Location
  requestLocation: () => Promise<void>;
  // Games
  fetchGames: () => Promise<void>;
  // Matchmaking
  startSearch: (gameSlug: GameSlug) => Promise<void>;
  cancelSearch: () => void;
  // Rooms
  createRoom: (gameSlug: GameSlug) => Promise<string>;
  createNamedRoom: (gameSlug: GameSlug, name: string) => Promise<string>;
  joinRoomByCode: (code: string) => Promise<void>;
  enterSocial: (gameSlug: GameSlug) => Promise<void>;
  setSocialMode: (mode: AppState['socialMode']) => void;
  forfeit: () => void;
  submitResult: (matchId: number, result: GameResult) => Promise<void>;
  // Match
  joinMatch: (matchId: number) => void;
  leaveMatch: () => void;
}

// Socket listeners live outside the component so they can be re-attached after
// a reconnect, which replaces the underlying socket instance.
function attachSocketListeners(dispatch: React.Dispatch<Action>) {
  api.onMatchStart(({ match_id, room_code, game }) => {
    dispatch({ type: 'SET_MATCH', payload: {
      id: match_id,
      room_code,
      game_id: 0,
      status: 'active',
      created_at: new Date().toISOString(),
      settings: {},
      game: { id: 0, slug: game, name: game, max_players: 2, is_1v1: true, default_time_sec: 60, category: 'competitive' }
    }});
    dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
  });
  api.onMatchFinished(({ results }) => console.log('[Match] Finished:', results));
  api.onPlayerJoined(({ player }) => console.log('[Match] Player joined:', player));
  api.onPlayerLeft(({ player_id }) => console.log('[Match] Player left:', player_id));
  api.onError(({ message }) => console.error('[Socket] Error:', message));
}

// Re-open the socket so its handshake carries the cookies of the session that
// now exists, then re-attach listeners to the new instance.
function resyncSocket(dispatch: React.Dispatch<Action>) {
  api.reconnect();
  attachSocketListeners(dispatch);
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Init: restore session + fetch games + connect socket
  useEffect(() => {
    async function init() {
      try {
        // Restore auth from API
        const me = await api.me();
        if (me.user) {
          dispatch({ type: 'SET_AUTH', payload: { status: 'authenticated', user: me.user } });
        } else if (me.guest_session_id) {
          dispatch({ type: 'SET_AUTH', payload: { 
            status: 'guest', 
            session: { guest_session_id: me.guest_session_id, display_name: `Guest_${me.guest_session_id.slice(-4)}` } 
          }});
        } else {
          dispatch({ type: 'SET_AUTH', payload: { status: 'unauthenticated' } });
        }

        // Fetch games
        const games = await api.getGames();
        dispatch({ type: 'SET_GAMES', payload: games });

        // Connect socket
        api.connect();
        attachSocketListeners(dispatch);

      } catch (err) {
        console.error('[App] Init error:', err);
        dispatch({ type: 'SET_AUTH', payload: { status: 'unauthenticated' } });
      }
    }

    init();

    return () => {
      api.disconnect();
    };
  }, []);

  // Auth actions
  const login = useCallback(async (username: string, password: string) => {
    const { user } = await api.login(username, password);
    dispatch({ type: 'SET_AUTH', payload: { status: 'authenticated', user } });
    resyncSocket(dispatch);
  }, []);

  const register = useCallback(async (username: string, email: string | undefined, password: string) => {
    const { user } = await api.register(username, email, password);
    dispatch({ type: 'SET_AUTH', payload: { status: 'authenticated', user } });
    resyncSocket(dispatch);
  }, []);

  const guest = useCallback(async (displayName?: string) => {
    const session = await api.guest(displayName);
    dispatch({ type: 'SET_AUTH', payload: { status: 'guest', session } });
    resyncSocket(dispatch);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    dispatch({ type: 'LOGOUT' });
    resyncSocket(dispatch);
  }, []);

  // Location
  const requestLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    
    const loc = await Location.getCurrentPositionAsync({});
    const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    dispatch({ type: 'SET_LOCATION', payload: coords });
    
    // Send to backend if authenticated
    if (state.auth.status === 'authenticated') {
      try {
        await api.updateLocation(coords.lat, coords.lng);
      } catch (err) {
        console.error('[Location] Failed to update:', err);
      }
    }
  }, [state.auth]);

  // Games
  const fetchGames = useCallback(async () => {
    const games = await api.getGames();
    dispatch({ type: 'SET_GAMES', payload: games });
  }, []);

  // Matchmaking
  const startSearch = useCallback(async (gameSlug: GameSlug) => {
    dispatch({ type: 'SET_SEARCHING', payload: { isSearching: true, game: gameSlug } });
    try {
      const result = await api.quickMatch({ game_slug: gameSlug });

      // Join the socket room immediately, even while still waiting. The server
      // emits 'match_start' to that room when the second player arrives, so a
      // player who has not joined it never learns their match began and waits
      // forever.
      api.joinMatch(result.match_id);

      if (result.status === 'active') {
        dispatch({ type: 'SET_MATCH', payload: {
          id: result.match_id,
          room_code: result.room_code,
          game_id: 0,
          status: 'active',
          created_at: new Date().toISOString(),
          settings: {},
          game: { id: 0, slug: result.game, name: result.game, max_players: 2, is_1v1: true, default_time_sec: 60, category: 'competitive' }
        }});
        dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
      }
      // If 'waiting', 'match_start' arrives over the socket room joined above.
    } catch (err) {
      console.error('[Matchmaking] Error:', err);
      dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
      throw err;
    }
  }, []);

  // Rooms: create a room and enter it, or join someone else's by code. Both
  // end in the same place as matchmaking, an active match with a room code.
  const enterMatch = useCallback((matchId: number, roomCode: string, gameSlug: GameSlug, roomName?: string) => {
    dispatch({ type: 'SET_MATCH', payload: {
      id: matchId,
      room_code: roomCode,
      game_id: 0,
      status: 'active',
      created_at: new Date().toISOString(),
      settings: {},
      game: { id: 0, slug: gameSlug, name: roomName ?? gameSlug, max_players: 20, is_1v1: false, default_time_sec: 0, category: 'social' }
    }});
    dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
    api.joinMatch(matchId);
  }, []);

  // Open a room under a chosen name and step straight into it.
  const createNamedRoom = useCallback(async (gameSlug: GameSlug, name: string) => {
    const room = await api.createRoom(gameSlug, {}, name);
    const joined = await api.joinRoom(room.code);
    enterMatch(joined.match_id, joined.room_code, joined.game, joined.name);
    return room.code;
  }, [enterMatch]);

  const createRoom = useCallback(async (gameSlug: GameSlug) => {
    const room = await api.createRoom(gameSlug, {});
    const joined = await api.joinRoom(room.code);
    enterMatch(joined.match_id, joined.room_code, joined.game, joined.name);
    return room.code;
  }, [enterMatch]);

  const joinRoomByCode = useCallback(async (code: string) => {
    const joined = await api.joinRoom(code.trim().toUpperCase());
    enterMatch(joined.match_id, joined.room_code, joined.game, joined.name);
  }, [enterMatch]);

  // Social: drop into any open channel that is not the one just left, and
  // start a fresh one when there is nowhere to go. This is what "next" does,
  // so skipping must never dead-end on an empty lobby.
  const setSocialMode = useCallback((mode: AppState['socialMode']) => {
    dispatch({ type: 'SET_SOCIAL_MODE', payload: mode });
  }, []);

  const enterSocial = useCallback(async (gameSlug: GameSlug) => {
    const leavingCode = state.currentMatch?.room_code;
    if (state.currentMatch) {
      api.leaveMatch(state.currentMatch.id);
      dispatch({ type: 'SET_MATCH', payload: null });
    }
    const rooms = await api.listRooms();
    const candidate = (rooms as unknown as { code: string; game: string }[]).find(
      (room) => room.game === gameSlug && room.code !== leavingCode,
    );
    const target = candidate ?? (await api.createRoom(gameSlug, {}));
    const joined = await api.joinRoom(target.code);
    enterMatch(joined.match_id, joined.room_code, joined.game, joined.name);
  }, [enterMatch, state.currentMatch]);

  // Leaving a ranked match early is a forfeit; the server settles it.
  const forfeit = useCallback(() => {
    if (state.currentMatch) api.leaveMatch(state.currentMatch.id);
    dispatch({ type: 'SET_MATCH', payload: null });
  }, [state.currentMatch]);

  const cancelSearch = useCallback(() => {
    dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
  }, []);

  const submitResult = useCallback(async (matchId: number, result: GameResult) => {
    await api.submitResult(matchId, result);
  }, []);

  // Match actions
  const joinMatch = useCallback((matchId: number) => {
    api.joinMatch(matchId);
  }, []);

  const leaveMatch = useCallback(() => {
    if (state.currentMatch) {
      api.leaveMatch(state.currentMatch.id);
    }
    dispatch({ type: 'SET_MATCH', payload: null });
  }, [state.currentMatch]);

  return (
    <AppContext.Provider value={{
      state,
      login, register, guest, logout,
      requestLocation,
      fetchGames,
      startSearch, cancelSearch, submitResult,
      createRoom, createNamedRoom, joinRoomByCode, enterSocial, setSocialMode, forfeit,
      joinMatch, leaveMatch,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}