// Trap Chat — For You
// The doomscroll surface, laid out the way TikTok lays out a feed: the video
// fills the frame, the action rail runs down the right, and the caption sits
// bottom-left over the video. Chat is an overlay on the video rather than a
// panel beside it, because anything that steals height from the video stops
// feeling like a feed.
//
// On the web the video becomes a centred 9:16 card with the rail beside it and
// up/down buttons further right, which is what TikTok does with a mouse.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
  Animated,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api from '../services/api';
import { GameSlug } from '../types';
import call, { CallState, videoSupported } from '../services/webrtc';
import { VideoStage } from '../components/VideoStage';
import { ActionRail } from '../components/ActionRail';
import { Icon } from '../components/Icon';
import { useLayout } from '../hooks/useLayout';
import { T } from '../theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface Line {
  id: string;
  from: string;
  text: string;
  system?: boolean;
}

export function SocialScreen() {
  const { state, enterSocial, leaveMatch, cancelSearch } = useApp();
  const { isWide, height } = useLayout();
  const match = state.currentMatch;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const drag = useRef(new Animated.Value(0)).current;
  const scroller = useRef<ScrollView | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [callDetail, setCallDetail] = useState<string | undefined>();
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  // Video is for 1:1 only. A twenty-person group call is a different product
  // and a different bill.
  const wantsVideo = state.socialMode === 'chat1v1' && videoSupported();

  const me =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : 'You';

  const next = useCallback(async () => {
    setError(null);
    setLines([]);
    setLiked(false);
    setSaved(false);
    setConnecting(true);
    // Finish the throw so the old chat leaves the screen instead of hanging
    // half-swiped while the request is in flight.
    Animated.timing(drag, {
      toValue: -SCREEN_HEIGHT,
      duration: 160,
      useNativeDriver: true,
    }).start();
    try {
      await enterSocial(state.socialMode as GameSlug);
    } catch (err: any) {
      setError(err?.message ?? 'Could not find anyone right now');
    } finally {
      setConnecting(false);
      drag.setValue(0);
    }
  }, [enterSocial, drag, state.socialMode]);

  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  // Swipe up to skip. The buttons do the same thing, because a swipe is
  // awkward with a mouse and this has to work in a desktop browser too.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy < 0) drag.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -110) {
          nextRef.current();
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (!match || !wantsVideo) return;
    let cancelled = false;
    call.start(match.id, {
      onLocalStream: (stream) => !cancelled && setLocalStream(stream),
      onRemoteStream: (stream) => !cancelled && setRemoteStream(stream),
      onState: (nextState, detail) => {
        if (cancelled) return;
        setCallState(nextState);
        setCallDetail(detail);
      },
    });
    return () => {
      cancelled = true;
      setLocalStream(null);
      setRemoteStream(null);
      setCallState('idle');
      call.stop();
    };
  }, [match?.id, wantsVideo]);

  useEffect(() => {
    if (!match) return;
    const add = (line: Omit<Line, 'id'>) =>
      setLines((prev) => [...prev, { ...line, id: `${Date.now()}-${Math.random()}` }]);
    const offChat = api.onChatMessage(({ from, text }) => add({ from, text }));
    const offJoined = api.onPlayerJoined(({ player }) => {
      add({ from: 'system', text: `${player.display_name} joined`, system: true });
      // The peer already in the room makes the offer, so both sides never
      // offer at once and collide.
      if (wantsVideo && call.active) call.makeOffer();
    });
    const offLeft = api.onPlayerLeft(() =>
      add({ from: 'system', text: 'They left. Swipe up for someone new.', system: true }),
    );
    return () => {
      offChat();
      offJoined();
      offLeft();
    };
  }, [match?.id]);

  const send = () => {
    const text = draft.trim();
    if (!text || !match) return;
    api.sendChatMessage(match.id, text);
    setLines((prev) => [...prev, { id: `${Date.now()}`, from: me, text }]);
    setDraft('');
  };

  if (connecting) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={T.accent} size="large" />
        <Text style={styles.emptyTitle}>Searching</Text>
        <Text style={styles.emptyBody}>
          Looking for {state.socialMode === 'chat1v1' ? 'someone to talk to' : 'a group to drop into'}.
        </Text>
        <TouchableOpacity
          style={styles.cancel}
          onPress={() => {
            setConnecting(false);
            cancelSearch();
            drag.setValue(0);
          }}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!match) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>💬</Text>
        <Text style={styles.emptyTitle}>For You</Text>
        <Text style={styles.emptyBody}>
          Drop into a channel with whoever is around. Swipe up any time to skip to
          someone new.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.cta} onPress={next} disabled={connecting}>
          <Text style={styles.ctaText}>Start</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const them =
    match.players?.find((p) => p.display_name !== me)?.display_name ??
    (match.game?.name ?? 'Room');

  const rail = (
    <ActionRail
      avatarLetter={them.charAt(0)}
      actions={[
        {
          key: 'like',
          icon: 'heart',
          label: 'Like',
          active: liked,
          count: liked ? 1 : 0,
          onPress: () => setLiked((v) => !v),
        },
        { key: 'comment', icon: 'comment', label: 'Comments', count: lines.filter((l) => !l.system).length },
        {
          key: 'save',
          icon: 'bookmark',
          label: 'Save',
          active: saved,
          count: saved ? 1 : 0,
          onPress: () => setSaved((v) => !v),
        },
        { key: 'skip', icon: 'share', label: 'Skip to next', onPress: next },
      ]}
    />
  );

  // The video, the caption over it, and the comment overlay. Shared by both
  // layouts so a phone and a desktop cannot drift apart.
  const stage = (
    <View style={styles.videoFrame}>
      {wantsVideo ? (
        <VideoStage
          localStream={localStream}
          remoteStream={remoteStream}
          state={callState}
          detail={callDetail}
          muted={muted}
          cameraOff={cameraOff}
          onToggleMute={() => {
            const nextMuted = !muted;
            setMuted(nextMuted);
            call.setMuted(nextMuted);
          }}
          onToggleCamera={() => {
            const nextOff = !cameraOff;
            setCameraOff(nextOff);
            call.setCameraOff(nextOff);
          }}
        />
      ) : (
        <View style={styles.noVideo}>
          <Text style={styles.noVideoIcon}>💬</Text>
          <Text style={styles.noVideoText}>Group chat</Text>
        </View>
      )}

      {/* COMMENTS OVER THE VIDEO */}
      <View style={styles.commentLayer} pointerEvents="box-none">
        <ScrollView
          ref={scroller}
          style={styles.chat}
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {lines.map((line) => (
            <View key={line.id} style={styles.line}>
              {line.system ? (
                <Text style={styles.system}>{line.text}</Text>
              ) : (
                <Text style={styles.msg}>
                  <Text style={styles.from}>{line.from} </Text>
                  {line.text}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      </View>

      {/* CAPTION BLOCK, BOTTOM LEFT, TIKTOK ORDER */}
      <View style={styles.caption} pointerEvents="box-none">
        <Text style={styles.handle}>@{them}</Text>
        <Text style={styles.captionText} numberOfLines={2}>
          #{match.room_code} · {match.game?.name ?? 'Chat'} · Swipe up to skip
        </Text>
        <View style={styles.ticker}>
          <Icon name="music" size={12} color={T.text} />
          <Text style={styles.tickerText} numberOfLines={1}>
            live audio · {them}
          </Text>
        </View>
      </View>

      <View style={styles.progress} />
    </View>
  );

  const composer = (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder="Add comment..."
        placeholderTextColor={T.textDim}
        onSubmitEditing={send}
        returnKeyType="send"
      />
      <TouchableOpacity onPress={send} style={styles.send} accessibilityLabel="Send">
        <Text style={styles.sendText}>Post</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={leaveMatch} style={styles.leave}>
        <Text style={styles.leaveText}>Leave</Text>
      </TouchableOpacity>
    </View>
  );

  // ---------- WIDE: CENTRED CARD, RAIL BESIDE IT, ARROWS OUTSIDE ----------
  if (isWide) {
    const cardHeight = Math.min(height - 40, 780);
    return (
      <View style={styles.wideRoot}>
        <View style={styles.wideCentre}>
          <Animated.View
            style={[
              styles.wideCard,
              { height: cardHeight, width: (cardHeight * 9) / 16 },
              { transform: [{ translateY: drag }] },
            ]}
            {...pan.panHandlers}
          >
            {stage}
          </Animated.View>

          <View style={styles.wideSide}>
            {rail}
            {composer ? null : null}
          </View>

          <View style={styles.arrows}>
            <TouchableOpacity style={styles.arrow} onPress={next} accessibilityLabel="Previous">
              <Icon name="chevronUp" size={20} color={T.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.arrow} onPress={next} accessibilityLabel="Next">
              <Icon name="chevronDown" size={20} color={T.text} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.wideComposer}>{composer}</View>
      </View>
    );
  }

  // ---------- NARROW: FULL BLEED ----------
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={[styles.stage, { transform: [{ translateY: drag }] }]} {...pan.panHandlers}>
        {stage}
        <View style={styles.railOverlay} pointerEvents="box-none">
          {rail}
        </View>
      </Animated.View>
      {composer}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  stage: { flex: 1 },

  // WIDE
  wideRoot: { flex: 1, backgroundColor: T.bg },
  wideCentre: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  wideCard: { backgroundColor: '#111', borderRadius: T.radius, overflow: 'hidden' },
  wideSide: { justifyContent: 'flex-end', paddingBottom: 30 },
  arrows: { gap: 12, justifyContent: 'center' },
  arrow: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: T.surfaceHi, alignItems: 'center', justifyContent: 'center',
  },
  wideComposer: { paddingHorizontal: 24, paddingBottom: 18, alignItems: 'center' },

  // VIDEO FRAME
  videoFrame: { flex: 1, backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  noVideo: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  noVideoIcon: { fontSize: 44 },
  noVideoText: { color: T.textDim, fontSize: 14, fontWeight: '600' },

  railOverlay: { position: 'absolute', right: 10, bottom: 120 },

  commentLayer: { position: 'absolute', left: 0, right: 74, bottom: 96, maxHeight: 190 },
  chat: { flexGrow: 0 },
  chatContent: { paddingHorizontal: 14, paddingVertical: 6 },
  line: { marginBottom: 7 },
  msg: { color: T.text, fontSize: 14, textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 4 },
  from: { color: T.textDim, fontWeight: '700' },
  system: { color: T.textDim, fontSize: 12, fontStyle: 'italic' },

  caption: { position: 'absolute', left: 14, right: 78, bottom: 22 },
  handle: { color: T.text, fontSize: 16, fontWeight: '800' },
  captionText: { color: T.text, fontSize: 13, marginTop: 5, lineHeight: 18 },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
  tickerText: { color: T.text, fontSize: 12, flexShrink: 1 },
  progress: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: T.accent },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 620, width: '100%' },
  input: {
    flex: 1, backgroundColor: T.surface, color: T.text,
    borderRadius: T.radiusPill, paddingHorizontal: 16, paddingVertical: 11,
    borderWidth: 1, borderColor: T.border,
  },
  send: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: T.radiusPill, backgroundColor: T.accent },
  sendText: { color: T.text, fontWeight: '800', fontSize: 13 },
  leave: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: T.radiusPill, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border },
  leaveText: { color: T.textDim, fontWeight: '700', fontSize: 13 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: T.bg },
  emptyIcon: { fontSize: 46 },
  emptyTitle: { color: T.text, fontSize: 26, fontWeight: '900', marginTop: 12 },
  emptyBody: { color: T.textDim, textAlign: 'center', marginTop: 10, lineHeight: 20 },
  error: { color: T.accent, marginTop: 14, textAlign: 'center' },
  cta: { marginTop: 26, backgroundColor: T.accent, paddingVertical: 15, paddingHorizontal: 54, borderRadius: T.radius },
  ctaText: { color: T.text, fontWeight: '900', fontSize: 17 },
  cancel: { marginTop: 24, paddingVertical: 13, paddingHorizontal: 34, borderRadius: T.radius, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border },
  cancelText: { color: T.accent, fontWeight: '800' },
});
