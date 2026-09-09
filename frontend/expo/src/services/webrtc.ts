// Trap Chat — WebRTC
// Peer-to-peer video and audio. The server only relays signalling; media
// never touches it, which is what keeps a chat app this cheap to run.
//
// A mesh, not a single call. This used to hold one RTCPeerConnection, which
// meant a room could only ever show one other person: a group room of five
// showed you whoever the last offer came from and nobody else. Each peer now
// gets its own connection, keyed by their socket id, because that is the only
// identity signalling can actually be routed to.
//
// Mesh is the right shape at this size and the wrong shape at scale: every
// participant uploads their camera once per other participant, so cost grows
// with the square of the room. MAX_VIDEO_PEERS is where that stops being
// worth it. An SFU is the answer beyond that and is not worth its price for a
// pilot, so the cap is honest rather than hidden — see SCALING.md.

import { Platform } from 'react-native';
import api from './api';
import { WebRTCSignal } from '../types';

// A public STUN server is enough to discover your own address behind most
// home routers. Symmetric NAT still needs a TURN relay, which costs money and
// is not set up, so a small share of connections will fail to establish.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// How many people we will open a video connection to. Past this everyone
// still gets a tile with their name on it — being in the room is not the same
// as being on camera, and a room that silently dropped people would be worse
// than one that admits the limit.
export const MAX_VIDEO_PEERS = 6;

export type CallState = 'idle' | 'requesting-media' | 'connecting' | 'connected' | 'failed';

/** One person in the room, as the grid needs to draw them. */
export interface PeerView {
  id: string;
  name: string | null;
  /** Null until their media arrives, or forever if they are past the cap. */
  stream: MediaStream | null;
  /** False while their connection is still being established. */
  connected: boolean;
}

export interface CallHandlers {
  onLocalStream?: (stream: MediaStream) => void;
  onPeers?: (peers: PeerView[]) => void;
  onState?: (state: CallState, detail?: string) => void;
}

export function videoSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof RTCPeerConnection !== 'undefined'
  );
}

interface PeerLink {
  id: string;
  name: string | null;
  pc: RTCPeerConnection | null;
  stream: MediaStream | null;
  connected: boolean;
  /** Candidates that arrived before there was a remote description to hold
   *  them. Applying one early throws, so they wait here. */
  pending: RTCIceCandidateInit[];
  makingOffer: boolean;
}

class CallSession {
  private links = new Map<string, PeerLink>();
  private local: MediaStream | null = null;
  private matchId: number | null = null;
  private myId: string | null = null;
  private handlers: CallHandlers = {};
  private unsubscribe: (() => void)[] = [];
  /** One outcome per call, so a flapping connection is not counted twice. */
  private outcomeReported = false;
  /** Resolves once getUserMedia has settled.
   *
   *  Subscribing has to happen before the camera prompt, not after: the room
   *  roster is sent the moment we join, and asking for a camera takes long
   *  enough that the message had already come and gone. The second person
   *  into a room saw only themselves, every time, while the first saw both --
   *  because the first was still in the room when the second arrived and so
   *  caught the later event instead.
   *
   *  But a connection built before the camera exists carries no tracks, so
   *  anything that touches one waits here first. */
  private mediaReady: Promise<void> = Promise.resolve();

  get active(): boolean {
    return this.local !== null;
  }

  /** Everyone else in the room, in a stable order so tiles do not jump. */
  get peers(): PeerView[] {
    return [...this.links.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, name, stream, connected }) => ({ id, name, stream, connected }));
  }

  private publish(): void {
    this.handlers.onPeers?.(this.peers);
  }

  async start(matchId: number, handlers: CallHandlers): Promise<void> {
    if (!videoSupported()) {
      handlers.onState?.('failed', 'Video is only available in a browser for now.');
      return;
    }
    await this.stop();
    this.matchId = matchId;
    this.handlers = handlers;

    handlers.onState?.('requesting-media');
    this.outcomeReported = false;

    this.unsubscribe = [
      api.onPeers(({ match_id, you, peers }) => {
        if (match_id !== this.matchId) return;
        this.myId = you;
        // Everyone already here. Each of them gets a connection, and the two
        // ids decide which end offers.
        for (const peer of peers) this.link(peer.peer_id, peer.display_name);
        this.publish();
      }),
      api.onPeerJoined(({ match_id, peer_id, display_name }) => {
        if (match_id !== this.matchId) return;
        this.link(peer_id, display_name);
        this.publish();
      }),
      api.onPeerLeft(({ match_id, peer_id }) => {
        if (match_id !== this.matchId) return;
        this.drop(peer_id);
        this.publish();
      }),
      api.onSignal((signal) => {
        this.handleSignal(signal).catch(() => {
          /* a malformed or out-of-order signal must not take the room down */
        });
      }),
    ];

    let released = () => {};
    this.mediaReady = new Promise<void>((resolve) => {
      released = resolve;
    });
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err: any) {
      released();
      handlers.onState?.(
        'failed',
        err?.name === 'NotAllowedError'
          ? 'Camera and microphone permission was denied.'
          : 'No camera or microphone available.',
      );
      return;
    }
    released();
    handlers.onLocalStream?.(this.local);

    // Anyone who arrived while the camera was being asked for is here but not
    // connected to. Connect to them now that there is something to send.
    for (const link of this.links.values()) {
      if (link.pc === null) this.open(link);
    }
    this.publish();

    handlers.onState?.('connecting');
  }

  /** Open a connection to a peer, and offer if this is the offering end. */
  private open(link: PeerLink): void {
    const negotiating = [...this.links.values()].filter((l) => l.pc !== null).length;
    if (negotiating >= MAX_VIDEO_PEERS) return;
    link.pc = this.connectionFor(link);
    // Exactly one end offers, or both offer at once and collide. Comparing
    // the two socket ids picks the same end on both sides without either
    // needing to know who arrived first.
    if (this.myId !== null && this.myId < link.id) void this.offerTo(link);
  }

  /**
   * Bring a peer into the room, and open a connection to them if there is
   * room for one. Past the cap they keep their tile and lose their video.
   */
  private link(peerId: string, name: string | null): PeerLink {
    const existing = this.links.get(peerId);
    if (existing) {
      if (name) existing.name = name;
      return existing;
    }
    const link: PeerLink = {
      id: peerId,
      name,
      pc: null,
      stream: null,
      connected: false,
      pending: [],
      makingOffer: false,
    };
    this.links.set(peerId, link);
    // Only once there is a camera to put on the connection. Until then they
    // are a tile with a name on it, which is the honest state anyway.
    if (this.local) this.open(link);
    return link;
  }

  private connectionFor(link: PeerLink): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.local?.getTracks().forEach((track) => pc.addTrack(track, this.local as MediaStream));

    pc.ontrack = (event) => {
      link.stream = event.streams[0] ?? null;
      this.publish();
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && this.matchId != null) {
        api.sendSignal({
          type: 'candidate',
          candidate: event.candidate.toJSON(),
          match_id: this.matchId,
          to: link.id,
        } as WebRTCSignal);
      }
    };
    pc.onconnectionstatechange = () => {
      // Whether a call actually reached the other side is invisible to the
      // server, which only ever sees the handshake go past. Reported once per
      // room, because it is the number that decides whether TURN is worth
      // paying for: STUN alone cannot cross symmetric NAT, and the share of
      // pairs that fail here is the size of that problem.
      if (pc.connectionState === 'connected') {
        link.connected = true;
        if (!this.outcomeReported) {
          this.outcomeReported = true;
          api.track('webrtc_connected');
        }
        this.handlers.onState?.('connected');
        this.publish();
      }
      if (pc.connectionState === 'failed') {
        link.connected = false;
        if (!this.outcomeReported) {
          this.outcomeReported = true;
          api.track('webrtc_failed');
        }
        // One peer failing is not the room failing. Their tile says so and
        // everybody else stays up.
        this.publish();
      }
    };
    return pc;
  }

  private async offerTo(link: PeerLink): Promise<void> {
    const pc = link.pc;
    if (!pc || this.matchId == null || link.makingOffer) return;
    link.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      api.sendSignal({
        type: 'offer',
        offer,
        match_id: this.matchId,
        to: link.id,
      } as WebRTCSignal);
    } catch {
      /* the peer may have gone between deciding to offer and offering */
    } finally {
      link.makingOffer = false;
    }
  }

  /**
   * Kept for the two-person case, where the caller drives negotiation itself.
   * Offers to everyone it can, which in a room of two is the other person.
   */
  async makeOffer(): Promise<void> {
    for (const link of this.links.values()) {
      if (link.pc && !link.stream) await this.offerTo(link);
    }
  }

  private async handleSignal(signal: WebRTCSignal & { from?: string }): Promise<void> {
    if (this.matchId == null || signal.match_id !== this.matchId) return;
    const from = signal.from;
    if (!from) return;
    // An offer can beat our own camera prompt. Answering it before there is a
    // camera would send back a connection with nothing on it.
    await this.mediaReady;
    if (!this.local || this.matchId == null) return;

    // A signal from somebody we have not met yet is how a peer arrives when
    // the roster message lost the race with their offer.
    const link = this.links.get(from) ?? this.link(from, null);
    if (!link.pc) {
      link.pc = this.connectionFor(link);
    }
    const pc = link.pc;

    if (signal.type === 'offer' && signal.offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
      await this.drain(link);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      api.sendSignal({
        type: 'answer',
        answer,
        match_id: this.matchId,
        to: from,
      } as WebRTCSignal);
      this.publish();
      return;
    }

    if (signal.type === 'answer' && signal.answer) {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
        await this.drain(link);
      }
      return;
    }

    if (signal.type === 'candidate' && signal.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        link.pending.push(signal.candidate);
      }
    }
  }

  private async drain(link: PeerLink): Promise<void> {
    const pc = link.pc;
    if (!pc) return;
    const queued = link.pending;
    link.pending = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* a candidate that no longer applies is not fatal */
      }
    }
  }

  private drop(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link) return;
    try {
      link.pc?.close();
    } catch {
      /* already closed */
    }
    this.links.delete(peerId);

    // A seat freed under the cap goes to somebody who was only a tile.
    const waiting = [...this.links.values()].find((l) => l.pc === null);
    if (waiting && this.local) this.open(waiting);
  }

  setMuted(muted: boolean): void {
    this.local?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  setCameraOff(off: boolean): void {
    this.local?.getVideoTracks().forEach((t) => {
      t.enabled = !off;
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe.forEach((off) => off());
    this.unsubscribe = [];
    for (const link of this.links.values()) {
      try {
        link.pc?.close();
      } catch {
        /* already closed */
      }
    }
    this.links.clear();
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.matchId = null;
    this.myId = null;
    this.handlers.onPeers?.([]);
    this.handlers = {};
  }
}

export const call = new CallSession();
export default call;
