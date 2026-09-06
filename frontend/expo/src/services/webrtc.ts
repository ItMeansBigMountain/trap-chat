// Trap Chat — WebRTC
// Peer-to-peer video and audio. The server only relays signalling; media
// never touches it, which is what keeps a chat app this cheap to run.

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

export type CallState = 'idle' | 'requesting-media' | 'connecting' | 'connected' | 'failed';

export interface CallHandlers {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
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

class CallSession {
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private offSignal: (() => void) | null = null;
  private matchId: number | null = null;
  private handlers: CallHandlers = {};
  // Candidates can arrive before the remote description is set; applying one
  // then throws, so hold them until there is somewhere to put them.
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private makingOffer = false;

  get active(): boolean {
    return this.pc !== null;
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
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err: any) {
      handlers.onState?.(
        'failed',
        err?.name === 'NotAllowedError'
          ? 'Camera and microphone permission was denied.'
          : 'No camera or microphone available.',
      );
      return;
    }
    handlers.onLocalStream?.(this.local);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    this.local.getTracks().forEach((track) => pc.addTrack(track, this.local as MediaStream));

    pc.ontrack = (event) => {
      handlers.onRemoteStream?.(event.streams[0] ?? null);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && this.matchId != null) {
        api.sendSignal({
          type: 'candidate',
          candidate: event.candidate.toJSON(),
          match_id: this.matchId,
        } as WebRTCSignal);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') handlers.onState?.('connected');
      if (pc.connectionState === 'failed') {
        handlers.onState?.('failed', 'Could not establish a direct connection.');
      }
    };

    this.offSignal = api.onSignal((signal) => {
      this.handleSignal(signal).catch(() => {
        /* a malformed or out-of-order signal must not take the call down */
      });
    });

    handlers.onState?.('connecting');
  }

  /** The peer already in the room offers; the one who just arrived answers. */
  async makeOffer(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.matchId == null || this.makingOffer) return;
    this.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      api.sendSignal({ type: 'offer', offer, match_id: this.matchId } as WebRTCSignal);
    } finally {
      this.makingOffer = false;
    }
  }

  private async handleSignal(signal: WebRTCSignal): Promise<void> {
    const pc = this.pc;
    if (!pc || this.matchId == null || signal.match_id !== this.matchId) return;

    if (signal.type === 'offer' && signal.offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
      await this.drainCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      api.sendSignal({ type: 'answer', answer, match_id: this.matchId } as WebRTCSignal);
      return;
    }

    if (signal.type === 'answer' && signal.answer) {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
        await this.drainCandidates();
      }
      return;
    }

    if (signal.type === 'candidate' && signal.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        this.pendingCandidates.push(signal.candidate);
      }
    }
  }

  private async drainCandidates(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* a candidate that no longer applies is not fatal */
      }
    }
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
    this.offSignal?.();
    this.offSignal = null;
    this.pendingCandidates = [];
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.pc = null;
    this.matchId = null;
    this.handlers.onRemoteStream?.(null);
    this.handlers = {};
  }
}

export const call = new CallSession();
export default call;
