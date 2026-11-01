import type { RoundTrack } from "@mg/shared";

export function TrackCard({ track, big = false }: { track: RoundTrack; big?: boolean }) {
  return (
    <div className={`track-card${big ? " big" : ""}`}>
      {track.coverUrl ? <img className="cover" src={track.coverUrl} alt="" /> : <div className="cover placeholder">♪</div>}
      <div>
        <div className="track-title">{track.title}</div>
        <div className="track-artist">{track.artist}</div>
      </div>
    </div>
  );
}
