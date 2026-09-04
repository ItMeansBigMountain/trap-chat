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
}

const initialState: AppState = {
  auth: { status: 'loading' },
  games: [],
  currentMatch: null,
  isSearching: false,
  searchGame: null,
  location: null,
};

// ── Actions ───────────────────────────────────────────────────────
type Action =
  | { type: 'SET_AUTH'; payload: AuthState }
  | { type: 'SET_GAMES'; payload: import('../types').Game[] }
  | { type: 'SET_MATCH'; payload: Match | null }
  | { type: 'SET_SEARCHING'; payload: { isSearching: boolean; game: GameSlug | null } }
  | { type: 'SET_LOCATION'; payload: { lat: number; lng: number } }
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
  guest: () => Promise<void>;
  logout: () => Promise<void>;
  // Location
  requestLocation: () => Promise<void>;
  // Games
  fetchGames: () => Promise<void>;
  // Matchmaking
  startSearch: (gameSlug: GameSlug) => Promise<void>;
  cancelSearch: () => void;
  submitResult: (matchId: number, result: GameResult) => Promise<void>;
  // Match
  joinMatch: (matchId: number) => void;
  leaveMatch: () => void;
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

        // Socket listeners
        api.onMatchStart(({ match_id, room_code, game }) => {
          dispatch({ type: 'SET_MATCH', payload: { 
            id: match_id, 
            room_code, 
            game_id: 0, 
            status: 'active',
            created_at: new Date().toISOString(),
            settings: {},
            game: { id: 0, slug: game, name: game, max_players: 2, is_1v1: true, default_time_sec: 60 }
          }});
          dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
        });

        api.onMatchFinished(({ results }) => {
          console.log('[Match] Finished:', results);
        });

        api.onPlayerJoined(({ player }) => {
          console.log('[Match] Player joined:', player);
        });

        api.onPlayerLeft(({ player_id }) => {
          console.log('[Match] Player left:', player_id);
        });

        api.onError(({ message }) => {
          console.error('[Socket] Error:', message);
        });

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
  }, []);

  const register = useCallback(async (username: string, email: string | undefined, password: string) => {
    const { user } = await api.register(username, email, password);
    dispatch({ type: 'SET_AUTH', payload: { status: 'authenticated', user } });
  }, []);

  const guest = useCallback(async () => {
    const session = await api.guest();
    dispatch({ type: 'SET_AUTH', payload: { status: 'guest', session } });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    dispatch({ type: 'LOGOUT' });
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
      
      if (result.status === 'active') {
        dispatch({ type: 'SET_MATCH', payload: { 
          id: result.match_id, 
          room_code: result.room_code, 
          game_id: 0,
          status: 'active',
          created_at: new Date().toISOString(),
          settings: {},
          game: { id: 0, slug: result.game, name: result.game, max_players: 2, is_1v1: true, default_time_sec: 60 }
        }});
        dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
        api.joinMatch(result.match_id);
      }
      // If 'waiting', server will emit 'match_start' when second player joins
    } catch (err) {
      console.error('[Matchmaking] Error:', err);
      dispatch({ type: 'SET_SEARCHING', payload: { isSearching: false, game: null } });
    }
  }, []);

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