type WaveformColor = 'primary' | 'red' | 'muted';

export function WaveformBars({
  active,
  color = 'primary',
  count = 32,
}: {
  active: boolean;
  color?: WaveformColor;
  count?: number;
}) {
  return (
    <div className={`voice-clone-waveform ${active ? 'active' : ''}`}>
      {Array.from({ length: count }).map((_, index) => {
        const height = active
          ? 28 + Math.abs(Math.sin(index * 0.65)) * 52 + Math.abs(Math.cos(index * 1.2)) * 18
          : 24;
        return (
          <span
            key={index}
            className={`voice-clone-waveform-bar ${color}`}
            style={{
              height: `${Math.min(100, height)}%`,
              animationDelay: `${(index % 6) * 70}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
