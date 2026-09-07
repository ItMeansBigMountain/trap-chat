// Trap Chat — Vote Panel
// The room deciding a battle. Shared by every judged game, because the rule is
// the same whatever was being judged: one vote each, changeable, never for
// yourself, and the tally is live for everyone watching.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import api, { VoteRow } from '../services/api';
import { useAccent } from '../hooks/useAccent';
import { T } from '../theme';

export function VotePanel({
  matchId,
  me,
  onLeave,
  leaveLabel = 'Leave battle',
}: {
  matchId: number;
  /** Display name of the viewer, so their own row can be disabled. */
  me: string;
  onLeave: () => void;
  leaveLabel?: string;
}) {
  const { accent, ink } = useAccent();
  const [tally, setTally] = useState<VoteRow[]>([]);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const votes = await api.getVotes(matchId);
      setTally(votes.tally);
      setMyVote(votes.my_vote);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load the vote');
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Someone else voting has to show up here without a refresh, or the tally
  // is a snapshot of the moment you arrived rather than the room's verdict.
  useEffect(() => api.onVoteUpdate(({ tally: next }) => setTally(next)), []);

  const vote = async (playerId: number) => {
    setError(null);
    try {
      const result = await api.castVote(matchId, playerId);
      setTally(result.tally);
      setMyVote(result.my_vote);
    } catch (err: any) {
      setError(err?.message ?? 'Could not record that vote');
    }
  };

  const total = tally.reduce((sum, row) => sum + row.votes, 0);

  return (
    <View>
      {tally.map((row) => {
        const isMe = row.display_name === me;
        const share = total ? Math.round((row.votes / total) * 100) : 0;
        return (
          <View key={row.player_id} style={styles.voteRow}>
            <View style={styles.voteHead}>
              <Text style={styles.voteName}>{row.display_name}</Text>
              <Text style={styles.voteCount}>
                {row.votes} {row.votes === 1 ? 'vote' : 'votes'}
              </Text>
            </View>
            <View style={styles.voteBar}>
              <View style={[styles.voteFill, { width: `${share}%`, backgroundColor: accent }]} />
            </View>
            <TouchableOpacity
              style={[
                styles.voteButton,
                myVote === row.player_id && { backgroundColor: accent },
                isMe && styles.voteButtonOff,
              ]}
              disabled={isMe}
              onPress={() => vote(row.player_id)}
            >
              <Text style={[styles.voteButtonText, myVote === row.player_id && { color: ink }]}>
                {isMe ? 'That is you' : myVote === row.player_id ? 'Your vote' : 'Vote'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.quiet} onPress={onLeave}>
        <Text style={styles.quietText}>{leaveLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  voteRow: {
    backgroundColor: T.surface,
    borderRadius: T.radius,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: T.border,
  },
  voteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  voteName: { color: T.text, fontWeight: '800', fontSize: 15 },
  voteCount: { color: T.textDim, fontSize: 12, fontWeight: '700' },
  voteBar: { height: 6, borderRadius: 3, backgroundColor: T.surfaceHi, marginTop: 8, overflow: 'hidden' },
  voteFill: { height: '100%' },
  voteButton: {
    marginTop: 11,
    paddingVertical: 10,
    borderRadius: T.radius,
    backgroundColor: T.surfaceHi,
    alignItems: 'center',
  },
  voteButtonOff: { opacity: 0.4 },
  voteButtonText: { color: T.text, fontWeight: '800', fontSize: 13 },
  error: { color: T.danger, marginTop: 12, textAlign: 'center' },
  quiet: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  quietText: { color: T.textDim, fontWeight: '700', fontSize: 13 },
});
